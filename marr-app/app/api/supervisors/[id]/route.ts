import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { hashPassword, isValidAdminPassword } from "@/lib/password";
import { groupIdsExist, isReportAccess, normalizeReportAccess, SUPERVISOR_COLUMNS, toSupervisorAccount } from "@/lib/supervisorAccount";
import type { ApiError, ReportAccess, SupervisorAccount, SupervisorPermissionsUpdate } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function loadOne(id: number): Promise<SupervisorAccount | null> {
  const rows = await query<RowDataPacket[]>(`SELECT ${SUPERVISOR_COLUMNS} FROM users WHERE id = ? AND role = 'supervisor'`, [
    id,
  ]);
  return rows[0] ? toSupervisorAccount(rows[0]) : null;
}

/**
 * PUT { can_manage_employees, can_manage_time_adjustment_history, timemint, ot, fixed_time }
 * (admin): sets this supervisor's permissions. Each is independent — not a fixed set of presets —
 * so an admin picks exactly the combination a given account needs. For each of the 3 report
 * accesses, `all: true` overrides `group_id` (normalized to null); otherwise `group_id` must name
 * an existing employee group, or be null (sees nobody via that report).
 */
export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse<SupervisorAccount | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Partial<SupervisorPermissionsUpdate>;
  if (
    typeof body.can_manage_employees !== "boolean" ||
    typeof body.can_manage_time_adjustment_history !== "boolean" ||
    !isReportAccess(body.timemint) ||
    !isReportAccess(body.ot) ||
    !isReportAccess(body.fixed_time)
  ) {
    return NextResponse.json(
      {
        error:
          "can_manage_employees, can_manage_time_adjustment_history (booleans) and timemint, ot, fixed_time ({ group_id, all }) are required",
      },
      { status: 400 }
    );
  }

  const timemint: ReportAccess = normalizeReportAccess(body.timemint);
  const ot: ReportAccess = normalizeReportAccess(body.ot);
  const fixedTime: ReportAccess = normalizeReportAccess(body.fixed_time);

  try {
    const groupIds = [timemint.group_id, ot.group_id, fixedTime.group_id].filter((g): g is number => g !== null);
    if (!(await groupIdsExist(groupIds))) {
      return NextResponse.json({ error: "No such employee group" }, { status: 400 });
    }

    const result = await execute(
      `UPDATE users SET can_manage_employees = ?, can_manage_time_adjustment_history = ?,
              timemint_group_id = ?, timemint_all = ?, ot_group_id = ?, ot_all = ?, fixed_time_group_id = ?, fixed_time_all = ?
       WHERE id = ? AND role = 'supervisor'`,
      [
        body.can_manage_employees,
        body.can_manage_time_adjustment_history,
        timemint.group_id,
        timemint.all,
        ot.group_id,
        ot.all,
        fixedTime.group_id,
        fixedTime.all,
        id,
      ]
    );
    if (result.affectedRows === 0) return NextResponse.json({ error: "Supervisor not found" }, { status: 404 });
    return NextResponse.json((await loadOne(id))!, { status: 200 });
  } catch (error) {
    console.error("PUT /api/supervisors/[id] failed:", error);
    return NextResponse.json({ error: "Failed to update permissions" }, { status: 500 });
  }
}

/** POST { password } (admin): resets a supervisor's password, unlocks the account, forces a change. */
export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse<SupervisorAccount | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const body = (await request.json().catch(() => ({}))) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (!isValidAdminPassword(password)) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const result = await execute(
      "UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ? AND role = 'supervisor'",
      [await hashPassword(password), id]
    );
    if (result.affectedRows === 0) return NextResponse.json({ error: "Supervisor not found" }, { status: 404 });
    await execute("DELETE FROM sessions WHERE user_id = ?", [id]);
    return NextResponse.json((await loadOne(id))!, { status: 200 });
  } catch (error) {
    console.error("POST /api/supervisors/[id] failed:", error);
    return NextResponse.json({ error: "Failed to reset password" }, { status: 500 });
  }
}

/** DELETE (admin): removes the supervisor account. Employee groups are untouched — groups exist independently of any login. */
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse<{ success: true } | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const result = await execute("DELETE FROM users WHERE id = ? AND role = 'supervisor'", [id]);
    if (result.affectedRows === 0) return NextResponse.json({ error: "Supervisor not found" }, { status: 404 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/supervisors/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete supervisor" }, { status: 500 });
  }
}
