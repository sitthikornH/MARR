import { NextRequest, NextResponse } from "next/server";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { hashPassword, isValidAdminPassword, isValidPin, verifyPassword } from "@/lib/password";
import type { ApiError } from "@/lib/types";

/**
 * POST { current_password, new_password }. Employees (role user) must choose a 4-digit PIN;
 * admins need at least 8 characters. The new password must differ from the current one.
 */
export async function POST(request: NextRequest): Promise<NextResponse<{ success: true } | ApiError>> {
  const gate = await requireAuth(request, { allowMustChange: true });
  if ("response" in gate) return gate.response;
  const { auth } = gate;

  let body: { current_password?: unknown; new_password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const current = typeof body.current_password === "string" ? body.current_password : "";
  const next = typeof body.new_password === "string" ? body.new_password : "";

  if (auth.role === "admin" ? !isValidAdminPassword(next) : !isValidPin(next)) {
    return NextResponse.json(
      { error: auth.role === "admin" ? "Admin password must be at least 8 characters" : "PIN must be exactly 4 digits" },
      { status: 400 }
    );
  }

  try {
    const userId: number = auth.user_id;
    const rows = await query<RowDataPacket[]>("SELECT password_hash FROM users WHERE id = ?", [userId]);
    const stored: string | null = rows[0]?.password_hash ?? null;
    if (!(await verifyPassword(current, stored))) {
      return NextResponse.json({ error: "Current password is wrong" }, { status: 400 });
    }
    if (await verifyPassword(next, stored)) {
      return NextResponse.json({ error: "The new password must be different from the current one" }, { status: 400 });
    }
    await execute("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [
      await hashPassword(next),
      userId,
    ]);
    return NextResponse.json({ success: true as const }, { status: 200 });
  } catch (error) {
    console.error("POST /api/auth/change-password failed:", error);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
