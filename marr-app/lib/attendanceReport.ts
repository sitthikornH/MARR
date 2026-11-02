// Builds TimeMint attendance-report rows (the HR1.xlsx layout) and the daily attendance rows the
// welfare calculation reads, from raw TimeMint API data. Pure functions, no DB or network access.
import {
  addDays,
  type TimeMintCheckLog,
  type TimeMintDatedHoliday,
  type TimeMintEmployeeProfile,
  type TimeMintLeave,
  type TimeMintOvertime,
  type TimeMintShift,
} from "@/lib/timemint";
import type { AttendanceDayType, AttendanceReportRow, ImportedAttendanceDay } from "@/lib/types";

const LOCATION_MAX = 100; // attendance.location_name VARCHAR(100)
const LEAVE_TYPE_MAX = 50; // attendance.leave_type VARCHAR(50)
const TEXT_MAX = 255;

export interface ReportSources {
  empCode: string;
  profile: TimeMintEmployeeProfile | null;
  checkLogs: TimeMintCheckLog[];
  leaves: TimeMintLeave[];
  overtimes: TimeMintOvertime[];
  shifts: TimeMintShift[];
  weeklyHolidays: TimeMintDatedHoliday[];
  annualHolidays: TimeMintDatedHoliday[];
  dateStart: string;
  dateEnd: string;
  today: string;
}

export interface BuiltReport {
  rows: AttendanceReportRow[];
  days: ImportedAttendanceDay[];
  warnings: string[];
}

const datePart = (dt: string) => dt.slice(0, 10);
const timePart = (dt: string) => dt.slice(11, 19);
const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t.slice(0, 8));

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + Math.round(hours * 60)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

/** "DuringWorktime" -> "During work time" (wording of the TimeMint export) */
function humanize(code: string): string {
  const words = code.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/\bworktime\b/g, "work time");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatOvertime(o: TimeMintOvertime, index: number): string {
  const hours = Math.floor(o.OvertimeMinutes / 60);
  const minutes = o.OvertimeMinutes % 60;
  const parts = [
    o.OvertimeID,
    o.OvertimeDate,
    `${o.OvertimeTimeStart} - ${o.OvertimeTimeEnd}`,
    `${hours} Hours ${minutes} Minutes ( ${o.OvertimeMinutes} )`,
    humanize(o.OvertimeType),
    humanize(o.OvertimeDayType),
    o.OvertimeReason || "",
    o.OvertimeRecordStatus,
  ];
  return `${index + 1}. [ ${parts.join(" | ")} ]`;
}

function leaveLabel(leave: TimeMintLeave): string {
  return leave.LeaveTypeEN || leave.LeaveType;
}

export function buildAttendanceReport(src: ReportSources): BuiltReport {
  const warnings: string[] = [];
  const profile = src.profile;
  const employeeName = (profile?.EmpNameEN || profile?.EmpNameTH || src.empCode).slice(0, TEXT_MAX);
  const position = profile?.EmpPosition ? profile.EmpPosition.slice(0, TEXT_MAX) : null;
  const department = profile?.EmpDepartment ? profile.EmpDepartment.slice(0, TEXT_MAX) : null;
  const approverCode = profile?.EmpApproverID ? profile.EmpApproverID.slice(0, TEXT_MAX) : null;

  // Default working hours when no shift is assigned: work time + hours per day (+1h if a break is set).
  const defaultStart = profile?.EmpWorkTime ? hhmmss(profile.EmpWorkTime) : null;
  const defaultEnd =
    defaultStart && profile?.WorkHoursPerDay
      ? addHours(defaultStart, Number(profile.WorkHoursPerDay) + (profile.EmpBreakTime ? 1 : 0))
      : null;

  const shiftByDate = new Map(src.shifts.map((s) => [s.ShiftDate, s]));
  const weekly = new Set(src.weeklyHolidays.map((h) => h.Date));
  const annual = new Map(src.annualHolidays.map((h) => [h.Date, h.DateINFO ?? ""]));

  const logsByDate = new Map<string, TimeMintCheckLog[]>();
  for (const log of src.checkLogs) {
    const stamp = log.CheckLogIn ?? log.CheckLogOut;
    if (!stamp) continue;
    const date = datePart(stamp);
    if (log.CheckLogIn && log.CheckLogOut && datePart(log.CheckLogOut) !== date) {
      warnings.push(`${date}: check-out is on ${datePart(log.CheckLogOut)} (overnight)`);
    }
    logsByDate.set(date, [...(logsByDate.get(date) ?? []), log]);
  }

  const overtimesByDate = new Map<string, TimeMintOvertime[]>();
  for (const o of src.overtimes) overtimesByDate.set(o.OvertimeDate, [...(overtimesByDate.get(o.OvertimeDate) ?? []), o]);

  const leavesByDate = new Map<string, TimeMintLeave[]>();
  for (const leave of src.leaves) {
    if (leave.LeaveUnit !== "Days") {
      warnings.push(
        `${datePart(leave.LeaveStart)}: ${leave.LeaveTotalHours}h ${leaveLabel(leave)} (hourly leave) not counted as a leave day`
      );
    }
    for (let d = datePart(leave.LeaveStart); d <= datePart(leave.LeaveEnd); d = addDays(d, 1)) {
      leavesByDate.set(d, [...(leavesByDate.get(d) ?? []), leave]);
    }
  }

  const rows: AttendanceReportRow[] = [];
  const days: ImportedAttendanceDay[] = [];

  for (let date = src.dateStart; date <= src.dateEnd; date = addDays(date, 1)) {
    const shift = shiftByDate.get(date);
    const isHoliday = weekly.has(date) || annual.has(date);
    const workStart = isHoliday ? null : shift?.ShiftDisplayStartWorkTime ? hhmmss(shift.ShiftDisplayStartWorkTime) : defaultStart;
    const workEnd = isHoliday ? null : shift?.ShiftDisplayEndWorkTime ? hhmmss(shift.ShiftDisplayEndWorkTime) : defaultEnd;

    const base = {
      emp_code: src.empCode,
      employee_name: employeeName,
      position,
      date,
      start_work_at: workStart,
      get_off_work_at: workEnd,
      overtime_request_history: null,
      checklog_id: null,
      day_type: (annual.has(date) ? "company_holiday" : weekly.has(date) ? "holiday" : "workday") as AttendanceDayType,
      holiday_name: annual.has(date) ? annual.get(date)!.slice(0, TEXT_MAX) || null : null,
      department,
      approver_code: approverCode,
    };
    const dayRows: AttendanceReportRow[] = [];

    const logs = (logsByDate.get(date) ?? []).sort((a, b) =>
      (a.CheckLogIn ?? a.CheckLogOut ?? "").localeCompare(b.CheckLogIn ?? b.CheckLogOut ?? "")
    );
    for (const log of logs) {
      dayRows.push({
        ...base,
        time_in: log.CheckLogIn ? timePart(log.CheckLogIn) : null,
        time_out: log.CheckLogOut ? timePart(log.CheckLogOut) : null,
        notice: log.CheckLogAdjustment ? "Time Adjustment" : null,
        place: log.CheckLogPlaceName ? log.CheckLogPlaceName.slice(0, TEXT_MAX) : null,
        row_type: "checklog",
        checklog_id: log.CheckLogID,
      });
    }

    const leaves = leavesByDate.get(date) ?? [];
    for (const leave of leaves) {
      dayRows.push({
        ...base,
        time_in: null,
        time_out: null,
        notice: `${leave.LeaveID} | ${leaveLabel(leave)}`.slice(0, 500),
        place: null,
        row_type: "leave",
      });
    }

    if (dayRows.length === 0) {
      const empty = { ...base, time_in: null, time_out: null, place: null };
      if (annual.has(date)) {
        dayRows.push({ ...empty, notice: `Company holiday (${annual.get(date)})`.slice(0, 500), row_type: "company_holiday" });
      } else if (weekly.has(date)) {
        dayRows.push({ ...empty, notice: "Holiday", row_type: "holiday" });
      } else if (date <= src.today) {
        dayRows.push({ ...empty, notice: "Absence all day", row_type: "absence" });
      } else {
        dayRows.push({ ...empty, notice: null, row_type: "none" });
      }
    }

    const overtimes = overtimesByDate.get(date);
    if (overtimes) dayRows[0].overtime_request_history = overtimes.map(formatOvertime).join("\n");

    rows.push(...dayRows);

    // Daily attendance row for the welfare calculation: earliest check-in, latest check-out,
    // first check-in's place; approved full-day leave sets leave_type.
    const fullDayLeave = leaves.find((l) => l.LeaveUnit === "Days");
    if (logs.length === 0 && !fullDayLeave) continue;

    const ins = dayRows.map((r) => r.time_in).filter((t): t is string => t !== null).sort();
    const outs = dayRows.map((r) => r.time_out).filter((t): t is string => t !== null).sort();
    let timeIn: string | null = ins[0] ?? null;
    let timeOut: string | null = outs[outs.length - 1] ?? null;
    if (timeIn && timeOut && timeOut <= timeIn) {
      warnings.push(`${date}: latest check-out ${timeOut} is not after first check-in ${timeIn}, time out left empty`);
      timeOut = null;
    }
    if (!timeIn && timeOut) {
      warnings.push(`${date}: check-out ${timeOut} without a check-in, day will not count for allowance or OT`);
      timeOut = null;
      timeIn = null;
    }
    if (timeIn && !timeOut && !fullDayLeave) {
      warnings.push(`${date}: no check-out, day will not count for allowance or OT`);
    }
    const firstPlace = dayRows.find((r) => r.row_type === "checklog" && r.time_in)?.place ?? dayRows.find((r) => r.place)?.place ?? null;

    days.push({
      date,
      time_in: timeIn,
      time_out: timeOut,
      location_name: firstPlace ? firstPlace.slice(0, LOCATION_MAX) : null,
      leave_type: fullDayLeave ? leaveLabel(fullDayLeave).slice(0, LEAVE_TYPE_MAX) : null,
    });
  }

  return { rows, days, warnings };
}
