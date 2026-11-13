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

/** "08:30:00" -> 510 */
function minutesOf(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 60 + m + (s ?? 0) / 60;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** "#L1878145 | Sick Leave" -> "Sick Leave" */
const leaveLabel = (notice: string | null) => (notice?.includes("|") ? notice.split("|").pop()!.trim() : notice ?? "Leave");

/**
 * Classifies one calendar day from its attendance_report rows.
 *
 * Allowance (kind "work"): on a workday, the check-in must exist and be at most 1h after the start
 * of work, and the check-out must exist and be at 13:00 or later. Otherwise the day is "uncounted".
 *
 * Work day (work_day, used by the return-home bonus): a counted workday ("work"), a worked holiday
 * with both a check-in and a check-out, or any company holiday (worked or not — a free day, per
 * the user).
 */
export function classifyDay(date: string, rows: DayRuleRow[]): AllowanceReportDay {
  if (rows.length === 0)
    return { date, time: null, recorded_time: null, site: null, note: null, work_day: false, company_holiday: false, kind: "none" };

  const companyHoliday = rows[0].day_type === "company_holiday";
  const empty = { date, time: null, recorded_time: null, site: null, note: null, work_day: companyHoliday, company_holiday: companyHoliday };
  const isHoliday = rows[0].day_type !== "workday";
  const holidayNote = rows[0].day_type === "company_holiday" ? rows[0].holiday_name || "Company holiday" : null;
  const logs = rows.filter((r) => r.row_type === "checklog");
  const leaves = rows.filter((r) => r.row_type === "leave");

  if (logs.length > 0) {
    const ins = logs.map((r) => r.time_in).filter((t): t is string => !!t).sort();
    const outs = logs.map((r) => r.time_out).filter((t): t is string => !!t).sort();
    const shift = rows[0].start_work_at && rows[0].get_off_work_at;
    const recordedTime = `${hhmm(ins[0] ?? null) ?? "?"}-${hhmm(outs[outs.length - 1] ?? null) ?? "?"}`;
    const time = shift ? `${hhmm(rows[0].start_work_at)}-${hhmm(rows[0].get_off_work_at)}` : recordedTime;
    const places = [...new Set(logs.map((r) => r.place).filter((p): p is string => !!p))];

    const start = rows[0].start_work_at;
    const lastOut = outs[outs.length - 1];
    const lateCheckIn = start !== null && ins.length > 0 && minutesOf(ins[0]) - minutesOf(start) > LATE_LIMIT_MINUTES;
    const earlyCheckOut = lastOut !== undefined && lastOut < EARLY_CHECKOUT_BEFORE;
    const noCheckIn = ins.length === 0 || (!isHoliday && lateCheckIn);
    const noCheckOut = outs.length === 0 || (!isHoliday && earlyCheckOut);
    const hasBothTimes = ins.length > 0 && lastOut !== undefined;

    const checkInNote = ins.length === 0 ? "ไม่มีเวลาเข้างาน" : !isHoliday && lateCheckIn ? "สายเกิน 1 ชั่วโมง" : null;
    const checkOutNote = outs.length === 0 ? "ไม่มีเวลาออกงาน" : !isHoliday && earlyCheckOut ? "ออกก่อน 13:00" : null;

    const notes = [holidayNote, ...leaves.map((l) => leaveLabel(l.notice)), checkInNote, checkOutNote].filter(
      (n): n is string => !!n
    );

    const kind = isHoliday ? "holiday_work" : noCheckIn || noCheckOut ? "uncounted" : "work";
    return {
      date,
      kind,
      time,
      recorded_time: recordedTime,
      site: places.join(", ") || null,
      note: notes.join("; ") || null,
      work_day: kind === "work" || (kind === "holiday_work" && hasBothTimes) || companyHoliday,
      company_holiday: companyHoliday,
    };
  }
  if (leaves.length > 0) {
    return { ...empty, kind: "leave", site: leaves.map((l) => leaveLabel(l.notice)).join(", ") };
  }
  if (isHoliday) return { ...empty, kind: "holiday", site: "X", note: holidayNote };
  if (rows.some((r) => r.row_type === "absence")) return { ...empty, kind: "absence", site: "Absent" };
  return { ...empty, kind: "none" };
}

const RETURN_HOME_HALF_RATIO = 0.5; // work days >= 50% of base days -> half of return_home_rate
const RETURN_HOME_FULL_RATIO = 0.8; // work days >= 80% of base days -> full return_home_rate

function sundayCount(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let sundays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === 0) sundays++;
  }
  return sundays;
}

export interface ReturnHomeBonus {
  amount: number;
  work_days: number;
  base_days: number;
  half_threshold_days: number;
  full_threshold_days: number;
}

/**
 * Welfare rule 4, tiered by work days / base days:
 *   base days = days in month - Sundays (leave days and company holidays are not deducted)
 *   work days < floor(50% of base)         -> 0
 *   floor(50%) <= work days < floor(80%)   -> half of return_home_rate
 *   work days >= floor(80% of base)        -> full return_home_rate
 * Fractions of a day in the thresholds are dropped. Used by the welfare calculation and the
 * mileage form's "ค่ากลับบ้าน" line.
 */
export function returnHomeBonus(year: number, month: number, rows: DayRuleRow[], returnHomeRate: number): ReturnHomeBonus {
  const days = classifyMonth(year, month, rows);
  const workDays = days.filter((d) => d.work_day).length;
  const baseDays = days.length - sundayCount(year, month);
  const half = Math.floor(baseDays * RETURN_HOME_HALF_RATIO + 1e-9);
  const full = Math.floor(baseDays * RETURN_HOME_FULL_RATIO + 1e-9);
  const amount = baseDays <= 0 ? 0 : workDays >= full ? returnHomeRate : workDays >= half ? returnHomeRate / 2 : 0;
  return { amount, work_days: workDays, base_days: baseDays, half_threshold_days: half, full_threshold_days: full };
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
