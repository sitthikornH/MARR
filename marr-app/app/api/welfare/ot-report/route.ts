import { NextRequest, NextResponse } from "next/server";
import { canAccessEmployee, forbidden, requireAuth } from "@/lib/auth";
import { query, type RowDataPacket } from "@/lib/db";
import {
  intersect,
  minutesToHHMM,
  otWindow,
  overlapMinutes,
  roundOtHours,
  toMinutes,
  workedIntervals,
} from "@/lib/otRules";
import type { ApiError, OtForm, OtFormRow, OtRowStatus } from "@/lib/types";

interface ReportRow extends RowDataPacket {
  date: string;
  time_in: string | null;
  time_out: string | null;
  place: string | null;
  row_type: string;
  day_type: string;
  holiday_name: string | null;
  position: string | null;
  employee_name: string;
}

interface OvertimeRow extends RowDataPacket {
  overtime_id: string;
  date: string;
  time_start: string;
  time_end: string;
  minutes: number;
  overtime_type: string | null;
  day_type: string | null;
  reason: string | null;
  status: string;
  requested_at: string | null;
}

const hhmm = (t: string) => t.slice(0, 5);

function statusOf(status: string): OtRowStatus {
  if (/^approved$/i.test(status)) return "approved";
  if (/^pending$/i.test(status)) return "pending";
  return "rejected";
}

/** "AnnualHoliday" -> "Annual holiday" */
const humanize = (code: string) => {
  const words = code.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Places of the check-logs whose time overlaps the window. */
function placesIn(logs: ReportRow[], window: [number, number] | null): string | null {
  const places = logs
    .filter((l) => {
      if (!window) return true;
      const s = l.time_in ? toMinutes(l.time_in) : l.time_out ? toMinutes(l.time_out) : null;
      const e = l.time_out ? toMinutes(l.time_out) : s;
      return s !== null && e !== null && e >= window[0] && s <= window[1];
    })
    .map((l) => l.place)
    .filter((p): p is string => !!p);
  return [...new Set(places)].join(", ") || null;
}

/**
 * GET ?employee_id=&month=&year= — every OT request of the month (approved, pending, rejected) next
 * to the check-in/out time actually logged inside the requested window, with the OT hours welfare
 * rule 3 counts, plus holidays worked without an OT request.
 */
export async function GET(request: NextRequest): Promise<NextResponse<OtForm | ApiError>> {
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

    const reportRows = await query<ReportRow[]>(
      `SELECT date, time_in, time_out, place, row_type, day_type, holiday_name, position, employee_name
       FROM attendance_report WHERE employee_id = ? AND YEAR(date) = ? AND MONTH(date) = ? ORDER BY date, id`,
      [employeeId, year, month]
    );
    const overtimes = await query<OvertimeRow[]>(
      `SELECT o.overtime_id, o.date, o.time_start, o.time_end, o.minutes, o.overtime_type, o.day_type, o.reason,
              o.status, a.requested_at
       FROM overtime_request o
       LEFT JOIN overtime_added_at a ON a.overtime_id = o.overtime_id
       WHERE o.employee_id = ? AND YEAR(o.date) = ? AND MONTH(o.date) = ? ORDER BY o.date, o.time_start`,
      [employeeId, year, month]
    );

    const byDate = new Map<string, ReportRow[]>();
    for (const r of reportRows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
    const logsOf = (date: string) => (byDate.get(date) ?? []).filter((r) => r.row_type === "checklog");
    const holidayOf = (date: string) => {
      const first = byDate.get(date)?.[0];
      if (first?.day_type === "company_holiday") return `วันหยุดบริษัท${first.holiday_name ? ` (${first.holiday_name})` : ""}`;
      if (first?.day_type === "holiday") return "วันหยุดประจำสัปดาห์";
      return null;
    };

    const rows: OtFormRow[] = overtimes.map((ot) => {
      const window = otWindow(ot.time_start, ot.time_end);
      const logs = logsOf(ot.date);
      const worked = workedIntervals(logs);
      const inside = intersect(worked, [window]);
      const minutes = overlapMinutes(worked, [window]);
      return {
        date: ot.date,
        overtime_id: ot.overtime_id,
        requested_at: ot.requested_at,
        requested_start: hhmm(ot.time_start),
        requested_end: hhmm(ot.time_end),
        requested_minutes: Number(ot.minutes) || window[1] - window[0],
        actual_start: inside.length ? minutesToHHMM(inside[0][0]) : null,
        actual_end: inside.length ? minutesToHHMM(inside[inside.length - 1][1]) : null,
        worked_minutes: Math.round(minutes),
        hours: roundOtHours(minutes),
        status: statusOf(ot.status),
        holiday: holidayOf(ot.date),
        place: placesIn(logs, window),
        description: ot.reason || [ot.overtime_type, ot.day_type].filter(Boolean).map((t) => humanize(t!)).join(" / ") || null,
      };
    });

    // Holidays worked (check-logs on a holiday) that have no OT request at all.
    const requested = new Set(overtimes.map((o) => o.date));
    for (const [date, dayRows] of byDate) {
      if (requested.has(date) || dayRows[0].day_type === "workday") continue;
      const logs = dayRows.filter((r) => r.row_type === "checklog");
      if (logs.length === 0) continue;
      const worked = workedIntervals(logs);
      const minutes = worked.reduce((sum, [s, e]) => sum + (e - s), 0);
      rows.push({
        date,
        overtime_id: null,
        requested_at: null,
        requested_start: null,
        requested_end: null,
        requested_minutes: 0,
        actual_start: worked.length ? minutesToHHMM(worked[0][0]) : null,
        actual_end: worked.length ? minutesToHHMM(worked[worked.length - 1][1]) : null,
        worked_minutes: Math.round(minutes),
        hours: 0,
        status: "no_request",
        holiday: holidayOf(date),
        place: placesIn(logs, null),
        description: "ทำงานวันหยุด (ไม่มีคำขอ OT)",
      });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || (a.requested_start ?? "").localeCompare(b.requested_start ?? ""));

    const latest = reportRows[reportRows.length - 1];
    const form: OtForm = {
      employee_id: employeeId,
      emp_code: employees[0].emp_code,
      employee_name: employees[0].name,
      position: latest?.position ?? null,
      month,
      year,
      rows,
      approved_hours: rows.filter((r) => r.status === "approved").reduce((s, r) => s + r.hours, 0),
      pending_hours: rows.filter((r) => r.status === "pending").reduce((s, r) => s + r.hours, 0),
      imported_days: byDate.size,
    };
    return NextResponse.json(form, { status: 200 });
  } catch (error) {
    console.error("GET /api/welfare/ot-report failed:", error);
    return NextResponse.json({ error: "Failed to build OT form" }, { status: 500 });
  }
}
