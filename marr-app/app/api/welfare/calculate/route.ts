import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { canAccessEmployee, forbidden, requireAuth } from "@/lib/auth";
import pool from "@/lib/db";
import { returnHomeBonus, type DayRuleRow } from "@/lib/dayRules";
import type { ApiError, WelfareCalculateRequest, WelfareCalculateResult } from "@/lib/types";

interface DayRuleRowPacket extends RowDataPacket, DayRuleRow {}

const MIN_ALLOWANCE_HOURS = 4; // allowance needs more than 4h from first check-in to last check-out, excluding lunch
const LUNCH_START_HOUR = 12; // 12:00-13:00 lunch break is not counted toward the 4h
const LUNCH_END_HOUR = 13;
const OT_ROUND_UP_MINUTES = 20; // per-day OT remainder: < 20 min dropped, >= 20 min rounds up to the next hour
interface EmployeeRow extends RowDataPacket {
  id: number;
  base_allowance: number;
  base_ot_rate: number;
  return_home_rate: number;
}

interface AttendanceWithFeeRow extends RowDataPacket {
  id: number;
  date: string;
  time_in: string | null;
  time_out: string | null;
  location_name: string | null;
  leave_type: string | null;
  travel_fee: number | null;
}

interface CheckLogRow extends RowDataPacket {
  date: string;
  time_in: string | null;
  time_out: string | null;
}

interface OvertimeRow extends RowDataPacket {
  date: string;
  time_start: string;
  time_end: string;
}

type Interval = [number, number]; // minutes from midnight, start < end

function timeStringToHours(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h + m / 60 + (s ?? 0) / 3600;
}

const toMinutes = (time: string) => timeStringToHours(time) * 60;

/** Hours from check-in to check-out minus the part that falls inside the 12:00-13:00 lunch break. */
function hoursExcludingLunch(timeIn: string, timeOut: string): number {
  const start = timeStringToHours(timeIn);
  const end = timeStringToHours(timeOut);
  const lunch = Math.max(0, Math.min(end, LUNCH_END_HOUR) - Math.max(start, LUNCH_START_HOUR));
  return end - start - lunch;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * A day's worked intervals from its check-log rows. A row with both times is one interval; rows
 * holding only a check-in or only a check-out (TimeMint records them separately) are paired in
 * time order, each check-in with the next check-out. Unpaired times are ignored.
 */
function workedIntervals(rows: CheckLogRow[]): Interval[] {
  const intervals: Interval[] = [];
  const events: { t: number; kind: "in" | "out" }[] = [];
  for (const r of rows) {
    if (r.time_in && r.time_out) intervals.push([toMinutes(r.time_in), toMinutes(r.time_out)]);
    else if (r.time_in) events.push({ t: toMinutes(r.time_in), kind: "in" });
    else if (r.time_out) events.push({ t: toMinutes(r.time_out), kind: "out" });
  }
  events.sort((a, b) => a.t - b.t);
  let openIn: number | null = null;
  for (const ev of events) {
    if (ev.kind === "in") openIn ??= ev.t;
    else if (openIn !== null) {
      intervals.push([openIn, ev.t]);
      openIn = null;
    }
  }
  return mergeIntervals(intervals);
}

function overlapMinutes(a: Interval[], b: Interval[]): number {
  let total = 0;
  for (const [as, ae] of a) for (const [bs, be] of b) total += Math.max(0, Math.min(ae, be) - Math.max(as, bs));
  return total;
}

/** Whole OT hours for one day: remainder < 20 min is dropped, >= 20 min rounds up. */
function roundOtHours(minutes: number): number {
  const whole = Math.floor(minutes / 60);
  return minutes - whole * 60 >= OT_ROUND_UP_MINUTES ? whole + 1 : whole;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<WelfareCalculateResult | ApiError>> {
  const gate = await requireAuth(request);
  if ("response" in gate) return gate.response;
  let body: Partial<WelfareCalculateRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { employee_id, month, year } = body;

  if (
    !employee_id ||
    !Number.isInteger(month) ||
    (month as number) < 1 ||
    (month as number) > 12 ||
    !Number.isInteger(year)
  ) {
    return NextResponse.json(
      { error: "employee_id, month (1-12), and year are required" },
      { status: 400 }
    );
  }

  const employeeId: number = employee_id;
  const monthNum: number = month as number;
  const yearNum: number = year as number;
  if (!canAccessEmployee(gate.auth, employeeId)) return forbidden();

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [employeeRows] = await connection.execute<EmployeeRow[]>(
      "SELECT id, base_allowance, base_ot_rate, return_home_rate FROM employees WHERE id = ?",
      [employeeId]
    );

    if (employeeRows.length === 0) {
      await connection.rollback();
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const employee = employeeRows[0];

    const [attendanceRows] = await connection.execute<AttendanceWithFeeRow[]>(
      `SELECT a.id, a.date, a.time_in, a.time_out, a.location_name, a.leave_type, lr.travel_fee
       FROM attendance a
       LEFT JOIN location_rates lr ON a.location_name = lr.location_name
       WHERE a.employee_id = ? AND YEAR(a.date) = ? AND MONTH(a.date) = ?`,
      [employeeId, yearNum, monthNum]
    );

    // Rule 1: Allowance - valid days have both time_in and time_out, and no leave_type; a day
    // only earns allowance if first check-in to last check-out is more than MIN_ALLOWANCE_HOURS.
    const validDays = attendanceRows.filter(
      (row) => row.time_in !== null && row.time_out !== null && row.leave_type === null
    );
    const allowanceDays = validDays.filter(
      (row) => hoursExcludingLunch(row.time_in as string, row.time_out as string) > MIN_ALLOWANCE_HOURS
    );
    const totalAllowance = allowanceDays.length * Number(employee.base_allowance);

    // Rule 2: Travel fee - sum travel_fee for every record whose location matches location_rates.
    const totalTravel = attendanceRows.reduce(
      (sum, row) => sum + (row.travel_fee !== null ? Number(row.travel_fee) : 0),
      0
    );

    // Rule 3: Overtime - only on days with an approved TimeMint OT request. OT minutes are the
    // check-in/out time that overlaps the request window(s); each day is rounded to whole hours.
    const [checkLogRows] = await connection.execute<CheckLogRow[]>(
      `SELECT date, time_in, time_out FROM attendance_report
       WHERE employee_id = ? AND row_type = 'checklog' AND YEAR(date) = ? AND MONTH(date) = ?`,
      [employeeId, yearNum, monthNum]
    );
    const [overtimeRows] = await connection.execute<OvertimeRow[]>(
      `SELECT date, time_start, time_end FROM overtime_request
       WHERE employee_id = ? AND status = 'Approved' AND YEAR(date) = ? AND MONTH(date) = ?`,
      [employeeId, yearNum, monthNum]
    );
    const otWindowsByDate = new Map<string, Interval[]>();
    for (const ot of overtimeRows) {
      const start = toMinutes(ot.time_start);
      let end = toMinutes(ot.time_end);
      if (end <= start) end = 24 * 60; // request past midnight: count up to the end of the day
      otWindowsByDate.set(ot.date, [...(otWindowsByDate.get(ot.date) ?? []), [start, end]]);
    }
    let totalOtHours = 0;
    for (const [date, windows] of otWindowsByDate) {
      const worked = workedIntervals(checkLogRows.filter((r) => r.date === date));
      totalOtHours += roundOtHours(overlapMinutes(worked, mergeIntervals(windows)));
    }
    const totalOt = totalOtHours * Number(employee.base_ot_rate);

    // Rule 4: Return home bonus, tiered by work days / base days — see returnHomeBonus() in
    // lib/dayRules.ts (shared with the mileage form).
    const [reportRows] = await connection.execute<DayRuleRowPacket[]>(
      `SELECT date, start_work_at, get_off_work_at, time_in, time_out, notice, place, row_type, day_type, holiday_name
       FROM attendance_report
       WHERE employee_id = ? AND YEAR(date) = ? AND MONTH(date) = ?
       ORDER BY date ASC, id ASC`,
      [employeeId, yearNum, monthNum]
    );
    const bonus = returnHomeBonus(yearNum, monthNum, reportRows, Number(employee.return_home_rate));
    const totalReturnHome = bonus.amount;

    await connection.execute(
      `INSERT INTO welfare_summary
         (employee_id, month, year, total_allowance, total_travel, total_ot, total_return_home)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         total_allowance = VALUES(total_allowance),
         total_travel = VALUES(total_travel),
         total_ot = VALUES(total_ot),
         total_return_home = VALUES(total_return_home)`,
      [employeeId, monthNum, yearNum, totalAllowance, totalTravel, totalOt, totalReturnHome]
    );

    await connection.commit();

    const result: WelfareCalculateResult = {
      employee_id: employeeId,
      month: monthNum,
      year: yearNum,
      total_allowance: totalAllowance,
      total_travel: totalTravel,
      total_ot: totalOt,
      total_return_home: totalReturnHome,
      ot_hours: totalOtHours,
      work_days: bonus.work_days,
      base_days: bonus.base_days,
      half_threshold_days: bonus.half_threshold_days,
      full_threshold_days: bonus.full_threshold_days,
    };

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    await connection.rollback();
    console.error("POST /api/welfare/calculate failed:", error);
    return NextResponse.json({ error: "Failed to calculate welfare" }, { status: 500 });
  } finally {
    connection.release();
  }
}
