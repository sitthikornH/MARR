// TimeMint attendance import shared by the per-employee import route, the company-wide import route
// and the background scheduler (instrumentation.ts) — which is why, like lib/employeeSync.ts, it
// imports lib/db directly.
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool, { execute, query } from "@/lib/db";
import { buildAttendanceReport, type BuiltReport } from "@/lib/attendanceReport";
import {
  addDays,
  fetchAnnualHolidays,
  fetchApprovedLeaves,
  fetchCheckLogs,
  fetchOvertimes,
  fetchProfiles,
  fetchShifts,
  fetchWeeklyHolidays,
  forEmployee,
  type ByEmployee,
  type Scope,
  type TimeMintCheckLog,
  type TimeMintDatedHoliday,
  type TimeMintEmployeeProfile,
  type TimeMintLeave,
  type TimeMintOvertime,
  type TimeMintShift,
} from "@/lib/timemint";
import type { CompanyHoliday, CompanyImportResult, SyncStatus } from "@/lib/types";

interface HolidayRow extends RowDataPacket, CompanyHoliday {}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** First and last day of a month: (2026, 10) -> ["2026-10-01", "2026-10-31"]. */
export function monthRange(year: number, month: number): [string, string] {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  return [start, addDays(addDays(start, 32).slice(0, 8) + "01", -1)];
}

export interface Sources {
  profiles: Map<string, TimeMintEmployeeProfile>;
  checkLogs: ByEmployee<TimeMintCheckLog>;
  leaves: ByEmployee<TimeMintLeave>;
  overtimes: ByEmployee<TimeMintOvertime>;
  overtimesFetched: boolean; // false -> keep previously saved OT requests
  shifts: ByEmployee<TimeMintShift>;
  weeklyHolidays: ByEmployee<TimeMintDatedHoliday>;
  annualHolidays: ByEmployee<TimeMintDatedHoliday>;
  companyHolidays: CompanyHoliday[]; // company-wide, overrides annualHolidays for the same date
  warnings: string[];
}

/** Runs an optional source; on failure records a warning and returns the fallback instead of failing. */
async function optional<T>(label: string, fallback: T, warnings: string[], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    warnings.push(`${label} could not be fetched (${error instanceof Error ? error.message : String(error)})`);
    return fallback;
  }
}

/**
 * Fetches everything the attendance report needs, for one employee or the whole company (one call
 * per TimeMint API per window). Check-ins and leaves are required; the rest only enrich the report,
 * so their failure (e.g. the API key lacks that topic) becomes a warning.
 */
export async function fetchSources(scope: Scope, dateStart: string, dateEnd: string): Promise<Sources> {
  const warnings: string[] = [];
  const checkLogs = await fetchCheckLogs(scope, dateStart, dateEnd);
  const leaves = await fetchApprovedLeaves(scope, dateStart, dateEnd);
  const profiles = await optional("Employee profile", new Map(), warnings, () => fetchProfiles(scope));
  const before = warnings.length;
  const overtimes = await optional("Overtime requests", new Map(), warnings, () => fetchOvertimes(scope, dateStart, dateEnd));
  const overtimesFetched = warnings.length === before;
  const shifts = await optional("Shifts", new Map(), warnings, () => fetchShifts(scope, dateStart, dateEnd));
  const weeklyHolidays = await optional("Weekly holidays", new Map(), warnings, () => fetchWeeklyHolidays(scope, dateStart, dateEnd));
  const annualHolidays = await optional("Annual holidays", new Map(), warnings, () => fetchAnnualHolidays(scope, dateStart, dateEnd));
  const companyHolidays = await query<HolidayRow[]>(
    "SELECT date, name FROM company_holidays WHERE date BETWEEN ? AND ?",
    [dateStart, dateEnd]
  );
  return { profiles, checkLogs, leaves, overtimes, overtimesFetched, shifts, weeklyHolidays, annualHolidays, companyHolidays, warnings };
}

/** Builds one employee's report rows and daily attendance from fetched sources. */
export function buildForEmployee(
  sources: Sources,
  empCode: string,
  dateStart: string,
  dateEnd: string,
  workShift?: string | null
): BuiltReport {
  return buildAttendanceReport({
    empCode,
    profile: sources.profiles.get(empCode) ?? null,
    checkLogs: forEmployee(sources.checkLogs, empCode),
    leaves: forEmployee(sources.leaves, empCode),
    overtimes: forEmployee(sources.overtimes, empCode),
    shifts: forEmployee(sources.shifts, empCode),
    weeklyHolidays: forEmployee(sources.weeklyHolidays, empCode),
    annualHolidays: forEmployee(sources.annualHolidays, empCode),
    companyHolidays: sources.companyHolidays,
    dateStart,
    dateEnd,
    today: localToday(),
    workShift,
  });
}

/**
 * Replaces one employee's attendance_report, overtime_request (only when the OT fetch succeeded)
 * and attendance rows in the range. Runs on the caller's connection/transaction. Returns how many
 * attendance rows were replaced.
 */
export async function saveEmployeeImport(
  connection: PoolConnection,
  employeeId: number,
  dateStart: string,
  dateEnd: string,
  built: BuiltReport,
  overtimes: TimeMintOvertime[],
  overtimesFetched: boolean
): Promise<number> {
  const id: number = employeeId;
  await connection.execute("DELETE FROM attendance_report WHERE employee_id = ? AND date BETWEEN ? AND ?", [id, dateStart, dateEnd]);
  for (const row of built.rows) {
    await connection.execute(
      `INSERT INTO attendance_report
         (employee_id, emp_code, employee_name, position, date, start_work_at, get_off_work_at,
          time_in, time_out, notice, overtime_request_history, place, row_type, checklog_id,
          day_type, holiday_name, department, approver_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        row.emp_code,
        row.employee_name,
        row.position,
        row.date,
        row.start_work_at,
        row.get_off_work_at,
        row.time_in,
        row.time_out,
        row.notice,
        row.overtime_request_history,
        row.place,
        row.row_type,
        row.checklog_id,
        row.day_type,
        row.holiday_name,
        row.department,
        row.approver_code,
      ]
    );
  }

  if (overtimesFetched) {
    await connection.execute("DELETE FROM overtime_request WHERE employee_id = ? AND date BETWEEN ? AND ?", [id, dateStart, dateEnd]);
    for (const ot of overtimes) {
      if (ot.OvertimeDate < dateStart || ot.OvertimeDate > dateEnd) continue;
      await connection.execute(
        `INSERT INTO overtime_request
           (employee_id, overtime_id, date, time_start, time_end, minutes, overtime_type, day_type, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           employee_id = VALUES(employee_id), date = VALUES(date), time_start = VALUES(time_start),
           time_end = VALUES(time_end), minutes = VALUES(minutes), overtime_type = VALUES(overtime_type),
           day_type = VALUES(day_type), reason = VALUES(reason), status = VALUES(status)`,
        [
          id,
          ot.OvertimeID,
          ot.OvertimeDate,
          ot.OvertimeTimeStart,
          ot.OvertimeTimeEnd,
          Number(ot.OvertimeMinutes) || 0,
          ot.OvertimeType || null,
          ot.OvertimeDayType || null,
          ot.OvertimeReason ? ot.OvertimeReason.slice(0, 500) : null,
          (ot.OvertimeRecordStatus || "").slice(0, 20),
        ]
      );
    }
  }

  const [deleted] = await connection.execute<ResultSetHeader>(
    "DELETE FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?",
    [id, dateStart, dateEnd]
  );
  for (const day of built.days) {
    await connection.execute(
      "INSERT INTO attendance (employee_id, date, time_in, time_out, location_name, leave_type) VALUES (?, ?, ?, ?, ?, ?)",
      [id, day.date, day.time_in, day.time_out, day.location_name, day.leave_type]
    );
  }
  return deleted.affectedRows;
}

async function recordImportOutcome(status: SyncStatus, message: string): Promise<void> {
  const trimmed: string = message.slice(0, 500);
  await execute(
    "UPDATE app_settings SET last_import_at = NOW(), last_import_status = ?, last_import_message = ? WHERE id = 1",
    [status, trimmed]
  );
}

let importInProgress = false;

/**
 * Imports every MARR employee's attendance for the range with one TimeMint call per API (GetByCom)
 * and saves all of them in one transaction. TimeMint employees not in MARR are skipped (run the
 * employee sync first); so are MARR employees TimeMint doesn't return.
 */
export async function runCompanyImport(dateStart: string, dateEnd: string): Promise<CompanyImportResult> {
  if (importInProgress) throw new Error("An import is already running");
  importInProgress = true;
  const started = Date.now();

  try {
    const sources = await fetchSources("company", dateStart, dateEnd);
    const employees = await query<RowDataPacket[]>("SELECT id, emp_code, name, work_shift FROM employees ORDER BY id");
    const timemintCodes = new Set([...sources.profiles.keys(), ...sources.checkLogs.keys()]);

    const result: CompanyImportResult = {
      date_start: dateStart,
      date_end: dateEnd,
      employees: [],
      not_in_timemint: [],
      not_in_marr: [...timemintCodes].filter((code) => !employees.some((e) => e.emp_code === code)),
      warnings: sources.warnings,
      seconds: 0,
    };

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const emp of employees) {
        const empCode: string = emp.emp_code;
        if (!timemintCodes.has(empCode)) {
          result.not_in_timemint.push(empCode);
          continue;
        }
        const built = buildForEmployee(sources, empCode, dateStart, dateEnd, emp.work_shift);
        const otList = forEmployee(sources.overtimes, empCode);
        await saveEmployeeImport(connection, emp.id, dateStart, dateEnd, built, otList, sources.overtimesFetched);
        result.employees.push({
          employee_id: emp.id,
          emp_code: empCode,
          name: emp.name,
          report_rows: built.rows.length,
          days: built.days.length,
          overtime_requests: otList.filter((o) => o.OvertimeDate >= dateStart && o.OvertimeDate <= dateEnd).length,
          warnings: built.warnings,
        });
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    result.seconds = Math.round((Date.now() - started) / 100) / 10;
    await recordImportOutcome(
      "success",
      `${dateStart}..${dateEnd}: ${result.employees.length} employee(s) imported` +
        (result.not_in_marr.length ? `, ${result.not_in_marr.length} not in MARR (sync employees first)` : "") +
        (result.warnings.length ? `, ${result.warnings.length} warning(s)` : "")
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordImportOutcome("error", message).catch(() => {});
    throw error;
  } finally {
    importInProgress = false;
  }
}
