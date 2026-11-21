import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { hashPassword, isValidAdminPassword } from "@/lib/password";
import {
  groupIdsExist,
  isReportAccess,
  NO_REPORT_ACCESS,
  normalizeReportAccess,
  SUPERVISOR_COLUMNS,
  toSupervisorAccount,
} from "@/lib/supervisorAccount";
import type { ApiError, ReportAccess, SupervisorAccount } from "@/lib/types";

/**
 * Supervisor accounts (role='supervisor', employee_id NULL): a restricted admin that can view the
 * TimeMint, OT & Work on holiday, and Fixed Time Request forms for employees in whichever employee
 * group(s) they're granted (or every employee, if granted "all") — nothing else by default.
 * Managed from Settings; employees are assigned to a group from the Employees page. Kept at a
 * separate path from /api/users/[employeeId] since that one is keyed by employee id, which these
 * accounts don't have.
 */

async function loadSupervisors(): Promise<SupervisorAccount[]> {
  const rows = await query<RowDataPacket[]>(`SELECT ${SUPERVISOR_COLUMNS} FROM users WHERE role = 'supervisor' ORDER BY username`);
  return rows.map(toSupervisorAccount);
}

export async function GET(request: NextRequest): Promise<NextResponse<SupervisorAccount[] | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await loadSupervisors(), { status: 200 });
  } catch (error) {
    console.error("GET /api/supervisors failed:", error);
    return NextResponse.json({ error: "Failed to fetch supervisors" }, { status: 500 });
  }
}

/**
 * POST { username, password, can_manage_employees?, can_manage_time_adjustment_history?, timemint?,
 * ot?, fixed_time? } (admin): creates a supervisor account, must_change_password forced. The
 * permissions are optional — each defaults to off / "sees nobody via this report" when omitted,
 * same as a brand-new account always has, but can be set right away instead of only afterward.
 */
export async function POST(request: NextRequest): Promise<NextResponse<SupervisorAccount | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      username?: unknown;
      password?: unknown;
      can_manage_employees?: unknown;
      can_manage_time_adjustment_history?: unknown;
      timemint?: unknown;
      ot?: unknown;
      fixed_time?: unknown;
    };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const canManageEmployees = body.can_manage_employees === undefined ? false : body.can_manage_employees;
    const canManageTimeAdjustmentHistory =
      body.can_manage_time_adjustment_history === undefined ? false : body.can_manage_time_adjustment_history;
    const timemintInput = body.timemint === undefined ? NO_REPORT_ACCESS : body.timemint;
    const otInput = body.ot === undefined ? NO_REPORT_ACCESS : body.ot;
    const fixedTimeInput = body.fixed_time === undefined ? NO_REPORT_ACCESS : body.fixed_time;

    if (username.length < 3 || username.length > 100) {
      return NextResponse.json({ error: "Username must be 3-100 characters" }, { status: 400 });
    }
    if (!isValidAdminPassword(password)) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (
      typeof canManageEmployees !== "boolean" ||
      typeof canManageTimeAdjustmentHistory !== "boolean" ||
      !isReportAccess(timemintInput) ||
      !isReportAccess(otInput) ||
      !isReportAccess(fixedTimeInput)
    ) {
      return NextResponse.json(
        {
          error:
            "can_manage_employees, can_manage_time_adjustment_history (booleans) and timemint, ot, fixed_time ({ group_id, all }) must be valid when given",
        },
        { status: 400 }
      );
    }

    const timemint: ReportAccess = normalizeReportAccess(timemintInput);
    const ot: ReportAccess = normalizeReportAccess(otInput);
    const fixedTime: ReportAccess = normalizeReportAccess(fixedTimeInput);
    const groupIds = [timemint.group_id, ot.group_id, fixedTime.group_id].filter((g): g is number => g !== null);
    if (!(await groupIdsExist(groupIds))) {
      return NextResponse.json({ error: "No such employee group" }, { status: 400 });
    }

    const result = await execute(
      `INSERT INTO users (employee_id, username, password_hash, role, must_change_password,
              can_manage_employees, can_manage_time_adjustment_history,
              timemint_group_id, timemint_all, ot_group_id, ot_all, fixed_time_group_id, fixed_time_all)
       VALUES (NULL, ?, ?, 'supervisor', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        await hashPassword(password),
        canManageEmployees,
        canManageTimeAdjustmentHistory,
        timemint.group_id,
        timemint.all,
        ot.group_id,
        ot.all,
        fixedTime.group_id,
        fixedTime.all,
      ]
    );
    const rows = await query<RowDataPacket[]>(`SELECT ${SUPERVISOR_COLUMNS} FROM users WHERE id = ?`, [result.insertId]);
    return NextResponse.json(toSupervisorAccount(rows[0]), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Duplicate entry")) {
      return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
    }
    console.error("POST /api/supervisors failed:", error);
    return NextResponse.json({ error: "Failed to create supervisor" }, { status: 500 });
  }
}
