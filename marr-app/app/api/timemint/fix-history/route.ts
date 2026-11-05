import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import pool, { query, type RowDataPacket } from "@/lib/db";
import { FIX_HISTORY_UPSERT_SQL, parseFixHistory, toFixHistoryTables } from "@/lib/fixHistory";
import type { ApiError, FixHistoryEmployeeResult } from "@/lib/types";

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
 * POST { employee_id, tables } (admin): saves one employee's time adjustment history, as read from
 * TimeMint's website in the admin's own browser (lib/fixHistoryBookmarklet.ts).
 */
export async function POST(request: NextRequest): Promise<NextResponse<FixHistoryEmployeeResult | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { employee_id?: unknown; tables?: unknown };
  const employeeIdNum = Number(body.employee_id);
  const tables = toFixHistoryTables(body.tables);
  if (!Number.isInteger(employeeIdNum) || !tables) {
    return NextResponse.json({ error: "employee_id and tables are required" }, { status: 400 });
  }
  const employeeId: number = employeeIdNum;

  try {
    const employees = await query<RowDataPacket[]>("SELECT emp_code, name FROM employees WHERE id = ?", [employeeId]);
    if (employees.length === 0) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    const { emp_code: empCode, name } = employees[0];

    const result: FixHistoryEmployeeResult = { employee_id: employeeId, emp_code: empCode, name, saved: 0, skipped: 0, error: null };
    const parsed = parseFixHistory(tables);
    if (!parsed.recognized) {
      result.error = "The page has no time adjustment table";
      return NextResponse.json(result, { status: 200 });
    }
    await saveRecords(employeeId, empCode, parsed.records);
    result.saved = parsed.records.length;
    result.skipped = parsed.skipped;
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("POST /api/timemint/fix-history failed:", error);
    return NextResponse.json({ error: "Failed to save time adjustment history" }, { status: 500 });
  }
}
