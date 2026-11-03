import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { isReturnHomeOption, RETURN_HOME_ERROR } from "@/lib/returnHome";
import type { ApiError, Employee, NewEmployee } from "@/lib/types";

/** GET: admins get every employee with their login account; a user gets only their own record. */
export async function GET(request: NextRequest): Promise<NextResponse<Employee[] | ApiError>> {
  const gate = await requireAuth(request);
  if ("response" in gate) return gate.response;
  const { auth } = gate;
  try {
    const ownOnly = auth.role !== "admin";
    const ownId: number = auth.employee_id ?? -1;
    const rows = await query<RowDataPacket[]>(
      `SELECT e.id, e.emp_code, e.name, e.base_allowance, e.base_ot_rate, e.return_home_rate, e.created_at,
              u.username, u.role, u.password_hash IS NOT NULL AS has_password, u.locked_until > NOW() AS locked
       FROM employees e LEFT JOIN users u ON u.employee_id = e.id
       ${ownOnly ? "WHERE e.id = ?" : ""}
       ORDER BY e.id ASC`,
      ownOnly ? [ownId] : []
    );
    const employees: Employee[] = rows.map((r) => ({
      id: r.id,
      emp_code: r.emp_code,
      name: r.name,
      base_allowance: r.base_allowance,
      base_ot_rate: r.base_ot_rate,
      return_home_rate: r.return_home_rate,
      created_at: r.created_at,
      account: ownOnly
        ? undefined
        : r.username
          ? { username: r.username, role: r.role, has_password: Boolean(r.has_password), locked: Boolean(r.locked) }
          : null,
    }));
    return NextResponse.json(employees, { status: 200 });
  } catch (error) {
    console.error("GET /api/employees failed:", error);
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<Employee | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const body = (await request.json()) as Partial<NewEmployee>;
    const { emp_code, name, base_allowance, base_ot_rate, return_home_rate } = body;

    if (
      !emp_code ||
      !name ||
      base_allowance === undefined ||
      base_ot_rate === undefined ||
      return_home_rate === undefined
    ) {
      return NextResponse.json(
        { error: "emp_code, name, base_allowance, base_ot_rate, and return_home_rate are required" },
        { status: 400 }
      );
    }

    if (!isReturnHomeOption(return_home_rate)) {
      return NextResponse.json({ error: RETURN_HOME_ERROR }, { status: 400 });
    }

    const result = await execute(
      "INSERT INTO employees (emp_code, name, base_allowance, base_ot_rate, return_home_rate) VALUES (?, ?, ?, ?, ?)",
      [emp_code, name, base_allowance, base_ot_rate, return_home_rate]
    );

    const rows = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance, base_ot_rate, return_home_rate, created_at FROM employees WHERE id = ?",
      [result.insertId]
    );

    return NextResponse.json(rows[0] as Employee, { status: 201 });
  } catch (error) {
    console.error("POST /api/employees failed:", error);
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 });
  }
}
