import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import pool, { query, type RowDataPacket } from "@/lib/db";
import { buildForEmployee, fetchSources, saveEmployeeImport } from "@/lib/companyImport";
import { CHECKLOG_MAX_RANGE_DAYS, daysBetween, forEmployee } from "@/lib/timemint";
import type { ApiError, TimeMintImportRequest, TimeMintImportResult } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fetches one employee's TimeMint data for a date range and builds (a) attendance-report rows in
 * the layout of TimeMint's report export and (b) one daily attendance row per worked/leave day for
 * the welfare calculation. With save=true both are written, replacing that employee's existing
 * rows in the range. The company-wide import is /api/timemint/attendance/all.
 */
export async function POST(request: NextRequest): Promise<NextResponse<TimeMintImportResult | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
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

    const sources = await fetchSources({ empId: empCode }, dateStart, dateEnd);
    const built = buildForEmployee(sources, empCode, dateStart, dateEnd);
    const warnings = [...sources.warnings, ...built.warnings];

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
        result.replaced = await saveEmployeeImport(
          connection,
          employeeId,
          dateStart,
          dateEnd,
          built,
          forEmployee(sources.overtimes, empCode),
          sources.overtimesFetched
        );
        await connection.commit();
        result.saved = true;
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
