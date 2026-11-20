import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { hashPassword, isValidAdminPassword } from "@/lib/password";
import type { ApiError, SupervisorAccount } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string }>;
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
    const rows = await query<RowDataPacket[]>("SELECT username FROM users WHERE id = ?", [id]);
    return NextResponse.json({ id, username: rows[0].username, has_password: true, locked: false }, { status: 200 });
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
