import { NextRequest, NextResponse } from "next/server";
import { canManageEmployees, requireAuth, supervisorGroupFilter } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { isReturnHomeOption, RETURN_HOME_ERROR } from "@/lib/returnHome";
import { isWorkShiftOption, WORK_SHIFT_ERROR } from "@/lib/workShift";
import type { ApiError, Employee, NewEmployee } from "@/lib/types";

/**
 * GET: admins get every employee with their login account; a user gets only their own record;
 * a supervisor — whether or not they have full Employees access (Settings > Supervisors,
 * can_manage_employees) — always gets only the employees reachable through any of their five report
 * grants (lib/auth.ts supervisorGroupFilter); can_manage_employees only adds their login account
 * info to each row and lets them edit/delete within that same scope (see /api/employees/[id] and
 * /api/users/[employeeId]). Without it, they only ever use this list to pick who to view the report
 * forms for, or (Settings > Time Adjustment History) submit records for.
 */
export async function GET(request: NextRequest): Promise<NextResponse<Employee[] | ApiError>> {
  const gate = await requireAuth(request);
  if ("response" in gate) return gate.response;
  const { auth } = gate;
  try {
    const manageAll = canManageEmployees(auth);
    const hideAccount = !manageAll;
    let where = "";
    let params: unknown[] = [];
    if (auth.role === "user") {
      where = "WHERE e.id = ?";
      params = [auth.employee_id ?? -1];
    } else if (auth.role === "supervisor") {
      const { allowAll, groupIds } = supervisorGroupFilter(auth);
      if (!allowAll) {
        where = groupIds.length > 0 ? `WHERE e.group_id IN (${groupIds.map(() => "?").join(", ")})` : "WHERE 1 = 0";
        params = groupIds;
      }
    }
    const rows = await query<RowDataPacket[]>(
      `SELECT e.id, e.emp_code, e.name, e.base_allowance, e.base_allowance_holiday, e.base_ot_rate, e.return_home_rate, e.work_shift, e.group_id, e.created_at,
              u.username, u.role, u.password_hash IS NOT NULL AS has_password, u.locked_until > NOW() AS locked
       FROM employees e LEFT JOIN users u ON u.employee_id = e.id
       ${where}
       ORDER BY e.id ASC`,
      params
    );
    const employees: Employee[] = rows.map((r) => ({
      id: r.id,
      emp_code: r.emp_code,
      name: r.name,
      base_allowance: r.base_allowance,
      base_allowance_holiday: r.base_allowance_holiday,
      base_ot_rate: r.base_ot_rate,
      return_home_rate: r.return_home_rate,
      work_shift: r.work_shift,
      group_id: r.group_id,
      created_at: r.created_at,
      account: hideAccount
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
  const gate = await requireAuth(request, { employees: true });
  if ("response" in gate) return gate.response;
  try {
    const body = (await request.json()) as Partial<NewEmployee>;
    const { emp_code, name, base_allowance, base_allowance_holiday, base_ot_rate, return_home_rate, work_shift } = body;

    if (
      !emp_code ||
      !name ||
      base_allowance === undefined ||
      base_allowance_holiday === undefined ||
      base_ot_rate === undefined ||
      return_home_rate === undefined ||
      work_shift === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "emp_code, name, base_allowance, base_allowance_holiday, base_ot_rate, return_home_rate, and work_shift are required",
        },
        { status: 400 }
      );
    }

    if (!isReturnHomeOption(return_home_rate)) {
      return NextResponse.json({ error: RETURN_HOME_ERROR }, { status: 400 });
    }
    if (!isWorkShiftOption(work_shift)) {
      return NextResponse.json({ error: WORK_SHIFT_ERROR }, { status: 400 });
    }

    const result = await execute(
      "INSERT INTO employees (emp_code, name, base_allowance, base_allowance_holiday, base_ot_rate, return_home_rate, work_shift) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [emp_code, name, base_allowance, base_allowance_holiday, base_ot_rate, return_home_rate, work_shift]
    );

    const rows = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance, base_allowance_holiday, base_ot_rate, return_home_rate, work_shift, group_id, created_at FROM employees WHERE id = ?",
      [result.insertId]
    );

    return NextResponse.json(rows[0] as Employee, { status: 201 });
  } catch (error) {
    console.error("POST /api/employees failed:", error);
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 });
  }
}
