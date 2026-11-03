import { NextRequest, NextResponse } from "next/server";
import pool, { execute, query, type RowDataPacket } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { createEmployeeAccount } from "@/lib/employeeSync";
import { hashPassword, phoneDigits } from "@/lib/password";
import { fetchEmployeeProfile } from "@/lib/timemint";
import type { ApiError, EmployeeAccount, UserRole } from "@/lib/types";

interface RouteParams {
  params: Promise<{ employeeId: string }>;
}

async function loadAccount(employeeId: number): Promise<EmployeeAccount | null> {
  const id: number = employeeId;
  const rows = await query<RowDataPacket[]>(
    `SELECT username, role, password_hash IS NOT NULL AS has_password, locked_until > NOW() AS locked
     FROM users WHERE employee_id = ?`,
    [id]
  );
  const r = rows[0];
  return r ? { username: r.username, role: r.role, has_password: Boolean(r.has_password), locked: Boolean(r.locked) } : null;
}

/**
 * POST { temp_password? } (admin): resets the employee's login to the phone number in TimeMint
 * (or temp_password when given), unlocks it and forces a new PIN at next login. Creates the
 * account first if the employee has none.
 */
export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse<EmployeeAccount | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;

  const employeeId = Number((await params).employeeId);
  if (!Number.isInteger(employeeId)) return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  const id: number = employeeId;
  const body = (await request.json().catch(() => ({}))) as { temp_password?: unknown };
  const temp = typeof body.temp_password === "string" ? body.temp_password.trim() : "";

  try {
    const employees = await query<RowDataPacket[]>("SELECT emp_code FROM employees WHERE id = ?", [id]);
    if (employees.length === 0) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    const empCode: string = employees[0].emp_code;

    const profile = await fetchEmployeeProfile(empCode);
    const phone = phoneDigits(profile?.EmpTel);
    const initial = temp || phone;
    if (!initial) {
      return NextResponse.json(
        { error: "This employee has no phone number in TimeMint. Enter a temporary password instead." },
        { status: 422 }
      );
    }

    if (!(await loadAccount(id))) {
      const connection = await pool.getConnection();
      try {
        const email = (profile?.EmpEmail ?? "").trim().toLowerCase();
        const local = email.includes("@") ? email.split("@")[0].slice(0, 100) : null;
        await createEmployeeAccount(connection, id, empCode, local, initial);
      } finally {
        connection.release();
      }
      if (!(await loadAccount(id))) {
        return NextResponse.json({ error: "No free username for this employee" }, { status: 409 });
      }
    }

    await execute(
      "UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE employee_id = ?",
      [await hashPassword(initial), id]
    );
    await execute(
      "DELETE s FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.employee_id = ?",
      [id]
    );
    return NextResponse.json((await loadAccount(id))!, { status: 200 });
  } catch (error) {
    console.error("POST /api/users/[employeeId] failed:", error);
    const message = error instanceof Error ? error.message : "Failed to reset login";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PUT { role } (admin): makes the employee's account an admin or a normal user. */
export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse<EmployeeAccount | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;

  const employeeId = Number((await params).employeeId);
  if (!Number.isInteger(employeeId)) return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  const id: number = employeeId;
  const body = (await request.json().catch(() => ({}))) as { role?: unknown };
  if (body.role !== "admin" && body.role !== "user") {
    return NextResponse.json({ error: "role must be 'admin' or 'user'" }, { status: 400 });
  }
  const role: UserRole = body.role;
  if (role === "user" && gate.auth.employee_id === id) {
    return NextResponse.json({ error: "You can't remove your own admin rights" }, { status: 400 });
  }

  try {
    const result = await execute("UPDATE users SET role = ? WHERE employee_id = ?", [role, id]);
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "This employee has no login yet. Reset it first." }, { status: 404 });
    }
    return NextResponse.json((await loadAccount(id))!, { status: 200 });
  } catch (error) {
    console.error("PUT /api/users/[employeeId] failed:", error);
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
  }
}
