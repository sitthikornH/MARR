// Session auth shared by every API route handler (so, like lib/employeeSync.ts, it imports lib/db).
// The browser holds a random token in an httpOnly cookie; the DB stores only its sha256.
import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { IDLE_TIMEOUT_MINUTES } from "@/lib/sessionRules";
import type { ApiError, AuthUser } from "@/lib/types";

export const SESSION_COOKIE = "marr_session";
const SESSION_HOURS = 12; // the longest a session can last, even when in constant use

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Records one row in login_history, snapshotting the user's current username/name/role. */
async function recordLoginEvent(userId: number, event: "login" | "logout"): Promise<void> {
  const rows = await query<RowDataPacket[]>(
    `SELECT u.username, u.role, e.name AS employee_name FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = ?`,
    [userId]
  );
  const row = rows[0];
  if (!row) return;
  await execute(
    "INSERT INTO login_history (user_id, username, employee_name, role, event) VALUES (?, ?, ?, ?, ?)",
    [userId, row.username, row.employee_name ?? null, row.role, event]
  );
}

/** Creates a session for the user and sets its cookie on the response. */
export async function startSession(response: NextResponse, request: NextRequest, userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const uid: number = userId;
  await execute("DELETE FROM sessions WHERE expires_at < NOW() OR last_active_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)", [
    IDLE_TIMEOUT_MINUTES,
  ]);
  await execute(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))",
    [uid, sha256(token), SESSION_HOURS]
  );
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  await recordLoginEvent(uid, "login");
}

export async function endSession(response: NextResponse, request: NextRequest): Promise<void> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = sha256(token);
    const rows = await query<RowDataPacket[]>("SELECT user_id FROM sessions WHERE token_hash = ?", [tokenHash]);
    const userId: number | undefined = rows[0]?.user_id;
    await execute("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
    if (userId) await recordLoginEvent(userId, "logout");
  }
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The signed-in user for this request, or null. A valid request counts as activity on the session. */
export async function getAuth(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = sha256(token);
  const rows = await query<RowDataPacket[]>(
    `SELECT u.id, u.username, u.role, u.employee_id, u.must_change_password, e.name AS employee_name,
            u.can_manage_employees, u.can_manage_time_adjustment_history,
            u.timemint_group_id, u.timemint_all, u.ot_group_id, u.ot_all, u.fixed_time_group_id, u.fixed_time_all
     FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN employees e ON e.id = u.employee_id
     WHERE s.token_hash = ? AND s.expires_at > NOW() AND s.last_active_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [tokenHash, IDLE_TIMEOUT_MINUTES]
  );
  const row = rows[0];
  if (!row) return null;
  await execute("UPDATE sessions SET last_active_at = NOW() WHERE token_hash = ?", [tokenHash]);
  return {
    user_id: row.id,
    username: row.username,
    role: row.role === "admin" || row.role === "supervisor" ? row.role : "user",
    employee_id: row.employee_id,
    employee_name: row.employee_name ?? null,
    must_change_password: Boolean(row.must_change_password),
    can_manage_employees: Boolean(row.can_manage_employees),
    can_manage_time_adjustment_history: Boolean(row.can_manage_time_adjustment_history),
    timemint_group_id: row.timemint_group_id,
    timemint_all: Boolean(row.timemint_all),
    ot_group_id: row.ot_group_id,
    ot_all: Boolean(row.ot_all),
    fixed_time_group_id: row.fixed_time_group_id,
    fixed_time_all: Boolean(row.fixed_time_all),
  };
}

type Gate = { auth: AuthUser } | { response: NextResponse<ApiError> };

/**
 * Route-handler guard. Usage:
 *   const gate = await requireAuth(request, { admin: true });
 *   if ("response" in gate) return gate.response;
 * Users who still have to change their first password are blocked unless allowMustChange is set.
 * `employees`/`timeAdjustmentHistory` also let through a supervisor with that permission (see
 * canManageEmployees/canManageTimeAdjustmentHistory below).
 */
export async function requireAuth(
  request: NextRequest,
  options: { admin?: boolean; employees?: boolean; timeAdjustmentHistory?: boolean; allowMustChange?: boolean } = {}
): Promise<Gate> {
  const auth = await getAuth(request);
  if (!auth) return { response: NextResponse.json({ error: "Please log in" }, { status: 401 }) };
  if (auth.must_change_password && !options.allowMustChange) {
    return { response: NextResponse.json({ error: "Please set a new password first" }, { status: 403 }) };
  }
  if (options.admin && auth.role !== "admin") {
    return { response: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  if (options.employees && !canManageEmployees(auth)) {
    return { response: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  if (options.timeAdjustmentHistory && !canManageTimeAdjustmentHistory(auth)) {
    return { response: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { auth };
}

/** Admins see every employee; a user sees only their own record. Supervisors never pass this one
 *  (they have no employee_id) — see canAccessSupervisedEmployee for their scoped three forms. */
export function canAccessEmployee(auth: AuthUser, employeeId: number): boolean {
  return auth.role === "admin" || auth.employee_id === employeeId;
}

/** A supervisor granted full Employees-page access (Settings > Supervisors) is treated like an
 *  admin on every employee, not just the ones assigned to them. */
export function canManageEmployees(auth: AuthUser): boolean {
  return auth.role === "admin" || (auth.role === "supervisor" && auth.can_manage_employees);
}

/** A supervisor granted the Time Adjustment History permission (Settings > Supervisors). */
export function canManageTimeAdjustmentHistory(auth: AuthUser): boolean {
  return auth.role === "admin" || (auth.role === "supervisor" && auth.can_manage_time_adjustment_history);
}

async function isInGroup(employeeId: number, groupId: number): Promise<boolean> {
  const rows = await query<RowDataPacket[]>("SELECT 1 FROM employees WHERE id = ? AND group_id = ?", [
    employeeId,
    groupId,
  ]);
  return rows.length > 0;
}

export type SupervisedReport = "timemint" | "ot" | "fixed_time";

function reportAccess(auth: AuthUser, report: SupervisedReport): { groupId: number | null; all: boolean } {
  if (report === "timemint") return { groupId: auth.timemint_group_id, all: auth.timemint_all };
  if (report === "ot") return { groupId: auth.ot_group_id, all: auth.ot_all };
  return { groupId: auth.fixed_time_group_id, all: auth.fixed_time_all };
}

/**
 * Like canAccessEmployee, but also lets a supervisor through for the three report routes they may
 * view (TimeMint, OT, Fixed Time Request) — everywhere else keeps using canAccessEmployee so
 * supervisors stay out of Welfare/Allowance/Mileage. A supervisor granted "all" for that report
 * (Settings > Supervisors) sees every employee there; one granted a specific group sees only
 * employees in it; one granted neither sees nobody via that report.
 */
export async function canAccessSupervisedEmployee(
  auth: AuthUser,
  employeeId: number,
  report: SupervisedReport
): Promise<boolean> {
  if (canAccessEmployee(auth, employeeId)) return true;
  if (auth.role !== "supervisor") return false;
  const { groupId, all } = reportAccess(auth, report);
  if (all) return true;
  if (groupId === null) return false;
  return isInGroup(employeeId, groupId);
}

/**
 * Which employees a supervisor may submit Time Adjustment/OT history records for (Settings >
 * Time Adjustment History): every employee if they also have full Employees access, else anyone
 * reachable through any of their three report grants (there's no separate scope just for this).
 */
export async function canManageEmployeeHistory(auth: AuthUser, employeeId: number): Promise<boolean> {
  if (canManageEmployees(auth)) return true;
  return (
    (await canAccessSupervisedEmployee(auth, employeeId, "timemint")) ||
    (await canAccessSupervisedEmployee(auth, employeeId, "ot")) ||
    (await canAccessSupervisedEmployee(auth, employeeId, "fixed_time"))
  );
}

/**
 * Which employees a plain supervisor (without full Employees access) may see at all — used to
 * scope GET /api/employees, e.g. for the /supervisor picker and Settings > Time Adjustment
 * History's employee list. `allowAll: true` means no filter is needed (every employee is visible
 * through at least one of their three report grants).
 */
export function supervisorGroupFilter(auth: AuthUser): { allowAll: boolean; groupIds: number[] } {
  const accesses = [reportAccess(auth, "timemint"), reportAccess(auth, "ot"), reportAccess(auth, "fixed_time")];
  if (accesses.some((a) => a.all)) return { allowAll: true, groupIds: [] };
  const groupIds = [...new Set(accesses.map((a) => a.groupId).filter((g): g is number => g !== null))];
  return { allowAll: false, groupIds };
}

export const forbidden = () => NextResponse.json({ error: "You can only view your own records" }, { status: 403 });
