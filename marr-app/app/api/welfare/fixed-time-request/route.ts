import { NextRequest, NextResponse } from "next/server";
import { canAccessEmployee, forbidden, requireAuth } from "@/lib/auth";
import { query, type RowDataPacket } from "@/lib/db";
import type { ApiError, FixedTimeRequestReport, FixedTimeRequestRow } from "@/lib/types";

interface RequestRow extends RowDataPacket, FixedTimeRequestRow {}

/** The value comes from a report file, and the page puts it in a link: allow web addresses only. */
const webUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

/** GET ?employee_id=&month=&year= — the employee's time adjustment requests dated in that month. */
export async function GET(request: NextRequest): Promise<NextResponse<FixedTimeRequestReport | ApiError>> {
  const gate = await requireAuth(request);
  if ("response" in gate) return gate.response;

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
  if (!canAccessEmployee(gate.auth, employeeId)) return forbidden();

  try {
    const employees = await query<RowDataPacket[]>("SELECT emp_code, name FROM employees WHERE id = ?", [employeeId]);
    if (employees.length === 0) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

    const rows = await query<RequestRow[]>(
      `SELECT record_no, record_type, date, from_time_in, from_time_out, to_time_in, to_time_out, reason, added_by,
              created_date, status, approver, image_url
       FROM time_adjustment_request
       WHERE employee_id = ? AND YEAR(date) = ? AND MONTH(date) = ?
       ORDER BY date, record_no`,
      [employeeId, year, month]
    );
    // TimeMint's page has no position, so it comes from the latest imported attendance.
    const positions = await query<RowDataPacket[]>(
      "SELECT position FROM attendance_report WHERE employee_id = ? AND position IS NOT NULL ORDER BY date DESC LIMIT 1",
      [employeeId]
    );

    return NextResponse.json(
      {
        employee_id: employeeId,
        emp_code: employees[0].emp_code,
        employee_name: employees[0].name,
        position: positions[0]?.position ?? null,
        month,
        year,
        rows: rows.map((r) => ({
          record_no: r.record_no,
          record_type: r.record_type,
          date: r.date,
          from_time_in: r.from_time_in,
          from_time_out: r.from_time_out,
          to_time_in: r.to_time_in,
          to_time_out: r.to_time_out,
          reason: r.reason,
          added_by: r.added_by,
          created_date: r.created_date,
          status: r.status,
          approver: r.approver,
          image_url: webUrl(r.image_url),
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET /api/welfare/fixed-time-request failed:", error);
    return NextResponse.json({ error: "Failed to load time adjustment requests" }, { status: 500 });
  }
}
