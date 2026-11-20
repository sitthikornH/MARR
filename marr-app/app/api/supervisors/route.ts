import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { hashPassword, isValidAdminPassword } from "@/lib/password";
import type { ApiError, SupervisorAccount } from "@/lib/types";

/**
 * Supervisor accounts (role='supervisor', employee_id NULL): a restricted admin that can view the
 * TimeMint, OT & Work on holiday, and Fixed Time Request forms for the employees assigned to them
 * (employees.supervisor_id) — nothing else. Managed from Settings; assigned per employee from the
 * Employees page. Kept at a separate path from /api/users/[employeeId] since that one is keyed by
 * employee id, which these accounts don't have.
 */

async function loadSupervisors(): Promise<SupervisorAccount[]> {
  const rows = await query<RowDataPacket[]>(
    "SELECT id, username, password_hash IS NOT NULL AS has_password, locked_until > NOW() AS locked FROM users WHERE role = 'supervisor' ORDER BY username"
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    has_password: Boolean(r.has_password),
    locked: Boolean(r.locked),
  }));
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

/** POST { username, password } (admin): creates a supervisor account, must_change_password forced. */
export async function POST(request: NextRequest): Promise<NextResponse<SupervisorAccount | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (username.length < 3 || username.length > 100) {
      return NextResponse.json({ error: "Username must be 3-100 characters" }, { status: 400 });
    }
    if (!isValidAdminPassword(password)) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const result = await execute(
      "INSERT INTO users (employee_id, username, password_hash, role, must_change_password) VALUES (NULL, ?, ?, 'supervisor', 1)",
      [username, await hashPassword(password)]
    );
    const rows = await query<RowDataPacket[]>("SELECT id, username FROM users WHERE id = ?", [result.insertId]);
    return NextResponse.json(
      { id: rows[0].id, username: rows[0].username, has_password: true, locked: false },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Duplicate entry")) {
      return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
    }
    console.error("POST /api/supervisors failed:", error);
    return NextResponse.json({ error: "Failed to create supervisor" }, { status: 500 });
  }
}
