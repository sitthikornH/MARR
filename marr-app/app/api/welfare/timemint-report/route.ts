import { NextRequest, NextResponse } from "next/server";
import { canAccessEmployee, forbidden, requireAuth } from "@/lib/auth";
import { query, type RowDataPacket } from "@/lib/db";
import type { ApiError, LeaveDays, TimeMintMonthReport, TimeMintReportDay } from "@/lib/types";

interface ReportRow extends RowDataPacket {
  date: string;
  start_work_at: string | null;
  get_off_work_at: string | null;
  time_in: string | null;
  time_out: string | null;
  place: string | null;
  row_type: string;
  day_type: string;
  holiday_name: string | null;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** TimeMint leave label (LeaveTypeEN) -> the report's leave column and its Thai name. */
function leaveColumn(label: string): { key: keyof LeaveDays | null; thai: string } {
  if (/personal/i.test(label)) return { key: "personal", thai: "ลากิจ" };
  if (/sick/i.test(label)) return { key: "sick", thai: "ลาป่วย" };
  if (/vacation|annual leave/i.test(label)) return { key: "vacation", thai: "ลาพักร้อน" };
  return { key: null, thai: label };
}

const zero = (): LeaveDays => ({ personal: 0, sick: 0, vacation: 0 });

function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * GET ?employee_id=&month=&year= — the month's check-ins in the layout of TimeMint's attendance
 * report: one line per day, every check-log with its place, and leave days per type. Built from the
 * stored attendance_report rows plus full-day leaves in attendance (imported from TimeMint).
 */
export async function GET(request: NextRequest): Promise<NextResponse<TimeMintMonthReport | ApiError>> {
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

    const rows = await query<ReportRow[]>(
      `SELECT date, start_work_at, get_off_work_at, time_in, time_out, place, row_type, day_type, holiday_name
       FROM attendance_report
       WHERE employee_id = ? AND YEAR(date) = ? AND MONTH(date) = ?
       ORDER BY date ASC, id ASC`,
      [employeeId, year, month]
    );
    // Full-day leaves only (hourly leaves are not counted as leave days).
    const leaveRows = await query<RowDataPacket[]>(
      "SELECT date, leave_type FROM attendance WHERE employee_id = ? AND YEAR(date) = ? AND MONTH(date) = ? AND leave_type IS NOT NULL",
      [employeeId, year, month]
    );
    const leaveByDate = new Map<string, string>(leaveRows.map((r) => [r.date as string, r.leave_type as string]));

    const byDate = new Map<string, ReportRow[]>();
    for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);

    const totals = zero();
    const days: TimeMintReportDay[] = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayRows = byDate.get(date) ?? [];
      const logs = dayRows.filter((r) => r.row_type === "checklog");
      const first = dayRows[0];

      const ins = logs.map((r) => r.time_in).filter((t): t is string => !!t).sort();
      const outs = logs.map((r) => r.time_out).filter((t): t is string => !!t).sort();
      const record = logs.length > 0 ? [hhmm(ins[0] ?? null) ?? "", hhmm(outs[outs.length - 1] ?? null) ?? ""].join(" ").trim() : null;

      const leave = zero();
      let note: string | null = null;
      const leaveLabel = leaveByDate.get(date);
      if (leaveLabel) {
        const col = leaveColumn(leaveLabel);
        if (col.key) {
          leave[col.key] = 1;
          totals[col.key] += 1;
        }
        note = col.thai;
      } else if (logs.length === 0 && first?.day_type === "company_holiday") {
        note = first.holiday_name || "วันหยุดบริษัท";
      }

      days.push({
        date,
        work_time:
          first?.start_work_at && first.get_off_work_at ? `${hhmm(first.start_work_at)} ${hhmm(first.get_off_work_at)}` : null,
        record: record || null,
        places: logs.map((r) => `[${hhmm(r.time_in) ?? "00:00"}->${hhmm(r.time_out) ?? "00:00"}] > [ ${r.place ?? "-"} ]`),
        note,
        leave,
        company_holiday: first?.day_type === "company_holiday",
        weekly_holiday: first?.day_type === "holiday",
      });
    }

    const report: TimeMintMonthReport = {
      employee_id: employeeId,
      emp_code: employees[0].emp_code,
      employee_name: employees[0].name,
      month,
      year,
      days,
      totals,
      worked_days: days.filter((d) => d.places.length > 0).length,
      imported_days: byDate.size,
      generated_at: localNow(),
    };
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    console.error("GET /api/welfare/timemint-report failed:", error);
    return NextResponse.json({ error: "Failed to build TimeMint report" }, { status: 500 });
  }
}
