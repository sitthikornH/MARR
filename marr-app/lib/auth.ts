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
    `SELECT u.id, u.username, u.role, u.employee_id, u.must_change_password, e.name AS employee_name
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
    role: row.role === "admin" ? "admin" : "user",
    employee_id: row.employee_id,
    employee_name: row.employee_name ?? null,
    must_change_password: Boolean(row.must_change_password),
  };
}

type Gate = { auth: AuthUser } | { response: NextResponse<ApiError> };

/**
 * Route-handler guard. Usage:
 *   const gate = await requireAuth(request, { admin: true });
 *   if ("response" in gate) return gate.response;
 * Users who still have to change their first password are blocked unless allowMustChange is set.
 */
export async function requireAuth(
  request: NextRequest,
  options: { admin?: boolean; allowMustChange?: boolean } = {}
): Promise<Gate> {
  const auth = await getAuth(request);
  if (!auth) return { response: NextResponse.json({ error: "Please log in" }, { status: 401 }) };
  if (auth.must_change_password && !options.allowMustChange) {
    return { response: NextResponse.json({ error: "Please set a new password first" }, { status: 403 }) };
  }
  if (options.admin && auth.role !== "admin") {
    return { response: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { auth };
}

/** Admins see every employee; a user sees only their own record. */
export function canAccessEmployee(auth: AuthUser, employeeId: number): boolean {
  return auth.role === "admin" || auth.employee_id === employeeId;
}

export const forbidden = () => NextResponse.json({ error: "You can only view your own records" }, { status: 403 });
