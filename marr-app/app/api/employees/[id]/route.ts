import { NextRequest, NextResponse } from "next/server";
import { canAccessEmployee, forbidden, requireAuth } from "@/lib/auth";
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
    if (!canAccessEmployee(gate.auth, employeeId)) return forbidden();

    const rows = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance, base_ot_rate, return_home_rate, work_shift, created_at FROM employees WHERE id = ?",
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
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const { id } = await params;
    const employeeId = Number(id);

    if (!Number.isInteger(employeeId)) {
      return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }

    let body: Partial<EmployeeRatesUpdate>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rates = [body.base_allowance, body.base_ot_rate, body.return_home_rate];
    if (rates.some((r) => typeof r !== "number" || !Number.isFinite(r) || r < 0)) {
      return NextResponse.json(
        { error: "base_allowance, base_ot_rate, and return_home_rate must be numbers >= 0" },
        { status: 400 }
      );
    }
    if (!isReturnHomeOption(body.return_home_rate)) {
      return NextResponse.json({ error: RETURN_HOME_ERROR }, { status: 400 });
    }
    if (!isWorkShiftOption(body.work_shift)) {
      return NextResponse.json({ error: WORK_SHIFT_ERROR }, { status: 400 });
    }
    const [baseAllowance, baseOtRate, returnHomeRate] = rates as number[];
    const workShift: string = body.work_shift;

    const result = await execute(
      "UPDATE employees SET base_allowance = ?, base_ot_rate = ?, return_home_rate = ?, work_shift = ? WHERE id = ?",
      [baseAllowance, baseOtRate, returnHomeRate, workShift, employeeId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const rows = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance, base_ot_rate, return_home_rate, work_shift, created_at FROM employees WHERE id = ?",
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
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const { id } = await params;
    const employeeId = Number(id);

    if (!Number.isInteger(employeeId)) {
      return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }

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
