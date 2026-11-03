import { NextRequest, NextResponse } from "next/server";
import { query, type RowDataPacket } from "@/lib/db";
import { classifyMonth, type DayRuleRow } from "@/lib/dayRules";
import type { AllowanceReport, ApiError } from "@/lib/types";

interface ReportRow extends RowDataPacket, DayRuleRow {
  employee_name: string;
  position: string | null;
  department: string | null;
  approver_code: string | null;
}

/**
 * GET ?employee_id=&month=&year= — the month's "Other Income for Allowance" data built from the
 * stored attendance_report rows (imported from TimeMint on /attendance/import).
 */
export async function GET(request: NextRequest): Promise<NextResponse<AllowanceReport | ApiError>> {
  const params = request.nextUrl.searchParams;
  const employeeIdNum = Number(params.get("employee_id"));
  const monthNum = Number(params.get("month"));
  const yearNum = Number(params.get("year"));

  if (!Number.isInteger(employeeIdNum) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12 || !Number.isInteger(yearNum)) {
    return NextResponse.json({ error: "employee_id, month (1-12), and year are required" }, { status: 400 });
  }
  const employeeId: number = employeeIdNum;
  const month: number = monthNum;
  const year: number = yearNum;

  try {
    const employees = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance FROM employees WHERE id = ?",
      [employeeId]
    );
    if (employees.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const employee = employees[0];

    const rows = await query<ReportRow[]>(
      `SELECT date, employee_name, position, department, approver_code, start_work_at, get_off_work_at,
              time_in, time_out, notice, place, row_type, day_type, holiday_name
       FROM attendance_report
       WHERE employee_id = ? AND YEAR(date) = ? AND MONTH(date) = ?
       ORDER BY date ASC, id ASC`,
      [employeeId, year, month]
    );

    const days = classifyMonth(year, month, rows);

    // Most frequent place among worked days is the form's "Site".
    const placeCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.row_type === "checklog" && row.place) placeCounts.set(row.place, (placeCounts.get(row.place) ?? 0) + 1);
    }
    const site = [...placeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const latest = rows[rows.length - 1];
    let directSuperior: string | null = latest?.approver_code ?? null;
    if (directSuperior) {
      const superiors = await query<RowDataPacket[]>("SELECT name FROM employees WHERE emp_code = ?", [directSuperior]);
      if (superiors.length > 0) directSuperior = `${superiors[0].name} (${directSuperior})`;
    }

    const report: AllowanceReport = {
      employee_id: employeeId,
      emp_code: employee.emp_code,
      employee_name: latest?.employee_name ?? employee.name,
      position: latest?.position ?? null,
      department: latest?.department ?? null,
      direct_superior: directSuperior,
      site,
      month,
      year,
      base_allowance: Number(employee.base_allowance),
      days,
      imported_days: new Set(rows.map((r) => r.date)).size,
    };
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    console.error("GET /api/welfare/allowance-report failed:", error);
    return NextResponse.json({ error: "Failed to build allowance report" }, { status: 500 });
  }
}
