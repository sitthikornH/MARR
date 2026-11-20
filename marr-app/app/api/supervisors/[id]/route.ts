import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { hashPassword, isValidAdminPassword } from "@/lib/password";
import type { ApiError, ReportScope, SupervisorAccount, SupervisorPermissionsUpdate } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function loadOne(id: number): Promise<SupervisorAccount | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, username, password_hash IS NOT NULL AS has_password, locked_until > NOW() AS locked,
            can_manage_employees, can_manage_time_adjustment_history, timemint_scope, ot_scope, fixed_time_scope
     FROM users WHERE id = ? AND role = 'supervisor'`,
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  const scope = (v: unknown): ReportScope => (v === "all" ? "all" : "own");
  return {
    id: r.id,
    username: r.username,
    has_password: Boolean(r.has_password),
    locked: Boolean(r.locked),
    can_manage_employees: Boolean(r.can_manage_employees),
    can_manage_time_adjustment_history: Boolean(r.can_manage_time_adjustment_history),
    timemint_scope: scope(r.timemint_scope),
    ot_scope: scope(r.ot_scope),
    fixed_time_scope: scope(r.fixed_time_scope),
  };
}

/**
 * PUT { can_manage_employees, can_manage_time_adjustment_history, timemint_scope, ot_scope,
 * fixed_time_scope } (admin): sets this supervisor's permissions. Each is independent — not a
 * fixed set of presets — so an admin picks exactly the combination a given account needs.
 */
export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse<SupervisorAccount | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Partial<SupervisorPermissionsUpdate>;
  const isScope = (v: unknown): v is ReportScope => v === "own" || v === "all";
  if (
    typeof body.can_manage_employees !== "boolean" ||
    typeof body.can_manage_time_adjustment_history !== "boolean" ||
    !isScope(body.timemint_scope) ||
    !isScope(body.ot_scope) ||
    !isScope(body.fixed_time_scope)
  ) {
    return NextResponse.json(
      {
        error:
          "can_manage_employees, can_manage_time_adjustment_history (booleans) and timemint_scope, ot_scope, fixed_time_scope ('own' or 'all') are required",
      },
      { status: 400 }
    );
  }

  try {
    const result = await execute(
      `UPDATE users SET can_manage_employees = ?, can_manage_time_adjustment_history = ?,
              timemint_scope = ?, ot_scope = ?, fixed_time_scope = ?
       WHERE id = ? AND role = 'supervisor'`,
      [body.can_manage_employees, body.can_manage_time_adjustment_history, body.timemint_scope, body.ot_scope, body.fixed_time_scope, id]
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

/** DELETE (admin): removes the supervisor account. Employees it was assigned to go unassigned (ON DELETE SET NULL). */
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
