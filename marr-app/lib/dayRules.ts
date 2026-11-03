// Per-day attendance rules shared by the allowance report and the welfare calculation (rule 4).
// Pure functions over stored attendance_report rows; no DB access.
import type { AllowanceReportDay } from "@/lib/types";

/** The attendance_report columns these rules read. */
export interface DayRuleRow {
  date: string;
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
const MIN_WORKED_HOURS = 4;
const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;

/** "08:30:00" -> 510 */
function minutesOf(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 60 + m + (s ?? 0) / 60;
}

function minutesExcludingLunch(timeIn: string, timeOut: string): number {
  const start = minutesOf(timeIn);
  const end = minutesOf(timeOut);
  return end - start - Math.max(0, Math.min(end, LUNCH_END) - Math.max(start, LUNCH_START));
}

/** 200 -> "3:20 h" */
function formatDuration(minutes: number): string {
  const m = Math.floor(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** "#L1878145 | Sick Leave" -> "Sick Leave" */
const leaveLabel = (notice: string | null) => (notice?.includes("|") ? notice.split("|").pop()!.trim() : notice ?? "Leave");

/**
 * Classifies one calendar day from its attendance_report rows.
 *
 * Allowance (kind "work"): on a workday, the check-in must exist and be at most 1h after the start
 * of work, the check-out must exist and be at 13:00 or later, and first check-in to last check-out
 * minus the 12:00-13:00 lunch break must be more than 4h. Otherwise the day is "uncounted".
 *
 * Work day (work_day, used by the return-home bonus): a counted workday ("work"), or a worked
 * holiday with both a check-in and a check-out and more than 4h excluding lunch.
 */
export function classifyDay(date: string, rows: DayRuleRow[]): AllowanceReportDay {
  const empty = { date, time: null, site: null, note: null, work_day: false };
  if (rows.length === 0) return { ...empty, kind: "none" };

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

    const start = rows[0].start_work_at;
    const lastOut = outs[outs.length - 1];
    const lateCheckIn = start !== null && ins.length > 0 && minutesOf(ins[0]) - minutesOf(start) > LATE_LIMIT_MINUTES;
    const earlyCheckOut = lastOut !== undefined && lastOut < EARLY_CHECKOUT_BEFORE;
    const noCheckIn = ins.length === 0 || (!isHoliday && lateCheckIn);
    const noCheckOut = outs.length === 0 || (!isHoliday && earlyCheckOut);
    const workedMinutes = ins.length > 0 && lastOut !== undefined ? minutesExcludingLunch(ins[0], lastOut) : null;
    const longEnough = workedMinutes !== null && workedMinutes > MIN_WORKED_HOURS * 60;
    const tooShort = !isHoliday && workedMinutes !== null && !longEnough;

    const notes = [
      holidayNote,
      ...leaves.map((l) => leaveLabel(l.notice)),
      noCheckIn ? "no check-in" : null,
      noCheckOut ? "no check-out" : null,
      tooShort
        ? `worked ${formatDuration(Math.max(0, workedMinutes!))} excl. lunch (not more than ${MIN_WORKED_HOURS} h)`
        : null,
    ].filter((n): n is string => !!n);

    const kind = isHoliday ? "holiday_work" : noCheckIn || noCheckOut || tooShort ? "uncounted" : "work";
    return {
      date,
      kind,
      time,
      site: places.join(", ") || null,
      note: notes.join("; ") || null,
      work_day: kind === "work" || (kind === "holiday_work" && longEnough),
    };
  }
  if (leaves.length > 0) {
    return { ...empty, kind: "leave", site: leaves.map((l) => leaveLabel(l.notice)).join(", ") };
  }
  if (isHoliday) return { ...empty, kind: "holiday", site: "X", note: holidayNote };
  if (rows.some((r) => r.row_type === "absence")) return { ...empty, kind: "absence", site: "Absent" };
  return { ...empty, kind: "none" };
}

/** Groups attendance_report rows by date and classifies every day of the month. */
export function classifyMonth(year: number, month: number, rows: DayRuleRow[]): AllowanceReportDay[] {
  const byDate = new Map<string, DayRuleRow[]>();
  for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);

  const days: AllowanceReportDay[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push(classifyDay(date, byDate.get(date) ?? []));
  }
  return days;
}
