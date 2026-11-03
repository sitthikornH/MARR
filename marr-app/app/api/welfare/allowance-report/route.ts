import { NextRequest, NextResponse } from "next/server";
import { query, type RowDataPacket } from "@/lib/db";
import type { AllowanceReport, AllowanceReportDay, ApiError } from "@/lib/types";

interface ReportRow extends RowDataPacket {
  date: string;
  employee_name: string;
  position: string | null;
  department: string | null;
  approver_code: string | null;
  start_work_at: string | null;
  get_off_work_at: string | null;
  time_in: string | null;
  time_out: string | null;
  notice: string | null;
  place: string | null;
  row_type: string;
  day_type: string;
  holiday_name: string | null;
}

const LATE_LIMIT_MINUTES = 60;
const EARLY_CHECKOUT_BEFORE = "13:00:00";
const MIN_ALLOWANCE_HOURS = 4;

/** 200 -> "3:20 h" */
function formatDuration(minutes: number): string {
  const m = Math.floor(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** "08:30:00" -> 510 */
function minutesOf(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 60 + m + (s ?? 0) / 60;
}

/** "#L1878145 | Sick Leave" -> "Sick Leave" */
const leaveLabel = (notice: string | null) => (notice?.includes("|") ? notice.split("|").pop()!.trim() : notice ?? "Leave");

function buildDay(date: string, rows: ReportRow[]): AllowanceReportDay {
  if (rows.length === 0) return { date, kind: "none", time: null, site: null, note: null };

  const isHoliday = rows[0].day_type !== "workday";
  const holidayNote = rows[0].day_type === "company_holiday" ? rows[0].holiday_name || "Company holiday" : null;
  const logs = rows.filter((r) => r.row_type === "checklog");
  const leaves = rows.filter((r) => r.row_type === "leave");

  if (logs.length > 0) {
    const ins = logs.map((r) => r.time_in).filter((t): t is string => !!t).sort();
    const outs = logs.map((r) => r.time_out).filter((t): t is string => !!t).sort();
    const shift = rows[0].start_work_at && rows[0].get_off_work_at;
    const time = shift
      ? `${hhmm(rows[0].start_work_at)}-${hhmm(rows[0].get_off_work_at)}`
      : `${hhmm(ins[0] ?? null) ?? "?"}-${hhmm(outs[outs.length - 1] ?? null) ?? "?"}`;
    const places = [...new Set(logs.map((r) => r.place).filter((p): p is string => !!p))];

    // On a workday, a missing check-in or a first check-in more than LATE_LIMIT_MINUTES after the
    // start of work is "no check-in"; a missing check-out or a last check-out before
    // EARLY_CHECKOUT_BEFORE is "no check-out". Either way the day is not counted for allowance.
    const start = rows[0].start_work_at;
    const lastOut = outs[outs.length - 1];
    const lateCheckIn = start !== null && ins.length > 0 && minutesOf(ins[0]) - minutesOf(start) > LATE_LIMIT_MINUTES;
    const earlyCheckOut = lastOut !== undefined && lastOut < EARLY_CHECKOUT_BEFORE;
    const noCheckIn = ins.length === 0 || (!isHoliday && lateCheckIn);
    const noCheckOut = outs.length === 0 || (!isHoliday && earlyCheckOut);
    // First check-in to last check-out must be more than MIN_ALLOWANCE_HOURS.
    const workedMinutes = ins.length > 0 && lastOut !== undefined ? minutesOf(lastOut) - minutesOf(ins[0]) : null;
    const tooShort = !isHoliday && workedMinutes !== null && workedMinutes <= MIN_ALLOWANCE_HOURS * 60;

    const notes = [
      holidayNote,
      ...leaves.map((l) => leaveLabel(l.notice)),
      noCheckIn ? "no check-in" : null,
      noCheckOut ? "no check-out" : null,
      tooShort ? `worked ${formatDuration(Math.max(0, workedMinutes!))} (not more than ${MIN_ALLOWANCE_HOURS} h)` : null,
    ].filter((n): n is string => !!n);
    return {
      date,
      kind: isHoliday ? "holiday_work" : noCheckIn || noCheckOut || tooShort ? "uncounted" : "work",
      time,
      site: places.join(", ") || null,
      note: notes.join("; ") || null,
    };
  }
  if (leaves.length > 0) {
    return { date, kind: "leave", time: null, site: leaves.map((l) => leaveLabel(l.notice)).join(", "), note: null };
  }
  if (isHoliday) return { date, kind: "holiday", time: null, site: "X", note: holidayNote };
  if (rows.some((r) => r.row_type === "absence")) return { date, kind: "absence", time: null, site: "Absent", note: null };
  return { date, kind: "none", time: null, site: null, note: null };
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

    const byDate = new Map<string, ReportRow[]>();
    for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);

    const daysInMonth = new Date(year, month, 0).getDate();
    const days: AllowanceReportDay[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push(buildDay(date, byDate.get(date) ?? []));
    }

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
      imported_days: byDate.size,
    };
    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    console.error("GET /api/welfare/allowance-report failed:", error);
    return NextResponse.json({ error: "Failed to build allowance report" }, { status: 500 });
  }
}
