import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import pool, { query, type RowDataPacket } from "@/lib/db";
import { FIX_HISTORY_UPSERT_SQL, parseFixHistory } from "@/lib/fixHistory";
import { NotLoggedInError, readFixHistoryTables } from "@/lib/timemintWeb";
import type { ApiError, FixHistoryEmployeeResult, FixHistoryImportResult } from "@/lib/types";

const PAUSE_BETWEEN_EMPLOYEES_MS = 1000;

let running = false;

/** Upserts on record_no and never deletes, so the table keeps the history. */
async function saveRecords(employeeId: number, empCode: string, records: ReturnType<typeof parseFixHistory>["records"]) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const r of records) {
      await connection.execute(FIX_HISTORY_UPSERT_SQL, [
        employeeId,
        r.record_no,
        empCode,
        r.record_type,
        r.added_by,
        r.date,
        r.from_time_in,
        r.from_time_out,
        r.to_time_in,
        r.to_time_out,
        r.reason,
        r.created_date,
        r.status,
        r.system_owner,
        r.approver,
        r.approval_type,
        r.image_url,
      ]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * POST { employee_ids } (admin): reads each employee's time adjustment history from TimeMint's website,
 * in the window opened with /api/timemint/web-session, and saves it in time_adjustment_request.
 */
export async function POST(request: NextRequest): Promise<NextResponse<FixHistoryImportResult | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { employee_ids?: unknown };
  const ids = new Set(Array.isArray(body.employee_ids) ? body.employee_ids.map(Number) : []);
  if (ids.size === 0 || [...ids].some((id) => !Number.isInteger(id))) {
    return NextResponse.json({ error: "Select at least one employee" }, { status: 400 });
  }
  if (running) return NextResponse.json({ error: "A fetch is already running" }, { status: 409 });

  running = true;
  const results: FixHistoryEmployeeResult[] = [];
  try {
    const employees = (await query<RowDataPacket[]>("SELECT id, emp_code, name FROM employees ORDER BY id")).filter((e) => ids.has(e.id));
    for (const [index, emp] of employees.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_EMPLOYEES_MS));
      const result: FixHistoryEmployeeResult = { employee_id: emp.id, emp_code: emp.emp_code, name: emp.name, saved: 0, skipped: 0, error: null };
      results.push(result);
      try {
        const parsed = parseFixHistory(await readFixHistoryTables(emp.emp_code));
        if (!parsed.recognized) {
          result.error = "The page has no time adjustment table";
          continue;
        }
        await saveRecords(emp.id, emp.emp_code, parsed.records);
        result.saved = parsed.records.length;
        result.skipped = parsed.skipped;
      } catch (error) {
        if (error instanceof NotLoggedInError) throw error;
        console.error(`Fix history failed for ${emp.emp_code}:`, error);
        result.error = "Could not read or save this employee's history";
      }
    }
    return NextResponse.json({ employees: results }, { status: 200 });
  } catch (error) {
    if (error instanceof NotLoggedInError) {
      return NextResponse.json({ error: `${error.message}. Open the window and log in first.` }, { status: 409 });
    }
    console.error("POST /api/timemint/fix-history failed:", error);
    return NextResponse.json({ error: "Failed to fetch time adjustment history" }, { status: 500 });
  } finally {
    running = false;
  }
}
