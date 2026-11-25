import { NextRequest, NextResponse } from "next/server";
import { canAccessEmployee, canManageEmployeeRecord, canManageEmployees, forbidden, requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { isReturnHomeOption, RETURN_HOME_ERROR } from "@/lib/returnHome";
import { isWorkShiftOption, WORK_SHIFT_ERROR } from "@/lib/workShift";
import type { ApiError, Employee, EmployeeRatesUpdate } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<Employee | ApiError>> {
  const gate = await requireAuth(request);
  if ("response" in gate) return gate.response;
  try {
    const { id } = await params;
    const employeeId = Number(id);

    if (!Number.isInteger(employeeId)) {
      return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }
    let allowed = canAccessEmployee(gate.auth, employeeId);
    if (!allowed && canManageEmployees(gate.auth)) allowed = await canManageEmployeeRecord(gate.auth, employeeId);
    if (!allowed) return forbidden();

    const rows = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance, base_allowance_holiday, base_ot_rate, return_home_rate, work_shift, group_id, created_at FROM employees WHERE id = ?",
      [employeeId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0] as Employee, { status: 200 });
  } catch (error) {
    console.error("GET /api/employees/[id] failed:", error);
    return NextResponse.json({ error: "Failed to fetch employee" }, { status: 500 });
  }
}

/** Updates an employee's welfare rates. emp_code and name are owned by the TimeMint sync. */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<Employee | ApiError>> {
  const gate = await requireAuth(request, { employees: true });
  if ("response" in gate) return gate.response;
  try {
    const { id } = await params;
    const employeeId = Number(id);

    if (!Number.isInteger(employeeId)) {
      return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }
    if (!(await canManageEmployeeRecord(gate.auth, employeeId))) return forbidden();

    let body: Partial<EmployeeRatesUpdate>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rates = [body.base_allowance, body.base_allowance_holiday, body.base_ot_rate, body.return_home_rate];
    if (rates.some((r) => typeof r !== "number" || !Number.isFinite(r) || r < 0)) {
      return NextResponse.json(
        { error: "base_allowance, base_allowance_holiday, base_ot_rate, and return_home_rate must be numbers >= 0" },
        { status: 400 }
      );
    }
    if (!isReturnHomeOption(body.return_home_rate)) {
      return NextResponse.json({ error: RETURN_HOME_ERROR }, { status: 400 });
    }
    if (!isWorkShiftOption(body.work_shift)) {
      return NextResponse.json({ error: WORK_SHIFT_ERROR }, { status: 400 });
    }
    if (body.group_id !== null && !Number.isInteger(body.group_id)) {
      return NextResponse.json({ error: "group_id must be an employee group's id, or null" }, { status: 400 });
    }
    const [baseAllowance, baseAllowanceHoliday, baseOtRate, returnHomeRate] = rates as number[];
    const workShift: string = body.work_shift;
    let groupId: number | null = null;
    if (body.group_id !== null) {
      const groups = await query<RowDataPacket[]>("SELECT id FROM employee_groups WHERE id = ?", [body.group_id]);
      if (groups.length === 0) {
        return NextResponse.json({ error: "No such employee group" }, { status: 400 });
      }
      groupId = body.group_id as number;
    }

    const result = await execute(
      "UPDATE employees SET base_allowance = ?, base_allowance_holiday = ?, base_ot_rate = ?, return_home_rate = ?, work_shift = ?, group_id = ? WHERE id = ?",
      [baseAllowance, baseAllowanceHoliday, baseOtRate, returnHomeRate, workShift, groupId, employeeId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const rows = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance, base_allowance_holiday, base_ot_rate, return_home_rate, work_shift, group_id, created_at FROM employees WHERE id = ?",
      [employeeId]
    );
    return NextResponse.json(rows[0] as Employee, { status: 200 });
  } catch (error) {
    console.error("PUT /api/employees/[id] failed:", error);
    return NextResponse.json({ error: "Failed to update employee" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<{ success: true } | ApiError>> {
  const gate = await requireAuth(request, { employees: true });
  if ("response" in gate) return gate.response;
  try {
    const { id } = await params;
    const employeeId = Number(id);

    if (!Number.isInteger(employeeId)) {
      return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }
    if (!(await canManageEmployeeRecord(gate.auth, employeeId))) return forbidden();

    const result = await execute("DELETE FROM employees WHERE id = ?", [employeeId]);

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/employees/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete employee" }, { status: 500 });
  }
}
