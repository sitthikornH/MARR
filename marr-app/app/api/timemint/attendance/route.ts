import { NextRequest, NextResponse } from "next/server";
import pool, { query, type ResultSetHeader, type RowDataPacket } from "@/lib/db";
import { buildAttendanceReport } from "@/lib/attendanceReport";
import {
  CHECKLOG_MAX_RANGE_DAYS,
  daysBetween,
  fetchAnnualHolidays,
  fetchApprovedLeaves,
  fetchCheckLogs,
  fetchEmployeeProfile,
  fetchOvertimes,
  fetchShifts,
  fetchWeeklyHolidays,
} from "@/lib/timemint";
import type { ApiError, TimeMintImportRequest, TimeMintImportResult } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Runs an optional source; on failure records a warning and returns the fallback instead of failing the import. */
async function optional<T>(label: string, fallback: T, warnings: string[], run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    warnings.push(`${label} could not be fetched (${error instanceof Error ? error.message : String(error)})`);
    return fallback;
  }
}

/**
 * Fetches an employee's TimeMint data for a date range and builds (a) attendance-report rows in
 * the layout of TimeMint's report export and (b) one daily attendance row per worked/leave day for
 * the welfare calculation. With save=true both are written, replacing that employee's existing
 * rows in the range.
 */
export async function POST(request: NextRequest): Promise<NextResponse<TimeMintImportResult | ApiError>> {
  let body: Partial<TimeMintImportRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { employee_id, date_start, date_end, save } = body;
  if (!Number.isInteger(employee_id) || !date_start || !date_end || !DATE_RE.test(date_start) || !DATE_RE.test(date_end)) {
    return NextResponse.json(
      { error: "employee_id, date_start and date_end (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }
  const employeeId: number = employee_id as number;
  const dateStart: string = date_start;
  const dateEnd: string = date_end;

  const span = daysBetween(dateStart, dateEnd);
  if (span < 0) {
    return NextResponse.json({ error: "date_end must be on or after date_start" }, { status: 400 });
  }
  if (span >= CHECKLOG_MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Date range must be at most ${CHECKLOG_MAX_RANGE_DAYS} days (TimeMint limit)` },
      { status: 400 }
    );
  }

  try {
    const employees = await query<RowDataPacket[]>("SELECT emp_code FROM employees WHERE id = ?", [employeeId]);
    if (employees.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const empCode: string = employees[0].emp_code;

    // Check-ins and leaves are required; the rest only enrich the report, so their failure
    // (e.g. the API key lacks that topic) becomes a warning.
    const warnings: string[] = [];
    const checkLogs = await fetchCheckLogs(empCode, dateStart, dateEnd);
    const leaves = await fetchApprovedLeaves(empCode, dateStart, dateEnd);
    const profile = await optional("Employee profile", null, warnings, () => fetchEmployeeProfile(empCode));
    const overtimes = await optional("Overtime requests", [], warnings, () => fetchOvertimes(empCode, dateStart, dateEnd));
    const shifts = await optional("Shifts", [], warnings, () => fetchShifts(empCode, dateStart, dateEnd));
    const weeklyHolidays = await optional("Weekly holidays", [], warnings, () =>
      fetchWeeklyHolidays(empCode, dateStart, dateEnd)
    );
    const annualHolidays = await optional("Annual holidays", [], warnings, () =>
      fetchAnnualHolidays(empCode, dateStart, dateEnd)
    );

    const built = buildAttendanceReport({
      empCode,
      profile,
      checkLogs,
      leaves,
      overtimes,
      shifts,
      weeklyHolidays,
      annualHolidays,
      dateStart,
      dateEnd,
      today: localToday(),
    });
    warnings.push(...built.warnings);

    const knownLocations = await query<RowDataPacket[]>("SELECT location_name FROM location_rates");
    const known = new Set(knownLocations.map((r) => r.location_name as string));
    const unmatched = [
      ...new Set(built.days.map((d) => d.location_name).filter((n): n is string => !!n && !known.has(n))),
    ];

    const result: TimeMintImportResult = {
      employee_id: employeeId,
      emp_code: empCode,
      date_start: dateStart,
      date_end: dateEnd,
      report_rows: built.rows,
      days: built.days,
      unmatched_locations: unmatched,
      warnings,
      saved: false,
      replaced: 0,
    };

    if (save === true) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.execute("DELETE FROM attendance_report WHERE employee_id = ? AND date BETWEEN ? AND ?", [
          employeeId,
          dateStart,
          dateEnd,
        ]);
        for (const row of built.rows) {
          await connection.execute(
            `INSERT INTO attendance_report
               (employee_id, emp_code, employee_name, position, date, start_work_at, get_off_work_at,
                time_in, time_out, notice, overtime_request_history, place, row_type, checklog_id,
                day_type, holiday_name, department, approver_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              employeeId,
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

        const [deleted] = await connection.execute<ResultSetHeader>(
          "DELETE FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?",
          [employeeId, dateStart, dateEnd]
        );
        for (const day of built.days) {
          await connection.execute(
            "INSERT INTO attendance (employee_id, date, time_in, time_out, location_name, leave_type) VALUES (?, ?, ?, ?, ?, ?)",
            [employeeId, day.date, day.time_in, day.time_out, day.location_name, day.leave_type]
          );
        }

        await connection.commit();
        result.saved = true;
        result.replaced = deleted.affectedRows;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("POST /api/timemint/attendance failed:", error);
    const message = error instanceof Error ? error.message : "Failed to import attendance from TimeMint";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
