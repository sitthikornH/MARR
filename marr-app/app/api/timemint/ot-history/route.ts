import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import pool, { query, type RowDataPacket } from "@/lib/db";
import { parseOtHistory, toOtHistoryTables } from "@/lib/otHistory";
import type { ApiError, FixHistoryEmployeeResult } from "@/lib/types";

/** Upserts on overtime_id and never deletes, so the table keeps the submission time of OT requests. */
async function saveRecords(employeeId: number, records: ReturnType<typeof parseOtHistory>["records"]) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const r of records) {
      await connection.execute(
        `INSERT INTO overtime_added_at (overtime_id, employee_id, requested_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id), requested_at = VALUES(requested_at)`,
        [r.overtime_id, employeeId, r.requested_at]
      );
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
 * POST { employee_id, tables } (admin): saves one employee's OT request submission times ("เพิ่มเมื่อ"),
 * as read from TimeMint's website in the admin's own browser (lib/fixHistoryBookmarklet.ts).
 */
export async function POST(request: NextRequest): Promise<NextResponse<FixHistoryEmployeeResult | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { employee_id?: unknown; tables?: unknown };
  const employeeIdNum = Number(body.employee_id);
  const tables = toOtHistoryTables(body.tables);
  if (!Number.isInteger(employeeIdNum) || !tables) {
    return NextResponse.json({ error: "employee_id and tables are required" }, { status: 400 });
  }
  const employeeId: number = employeeIdNum;

  try {
    const employees = await query<RowDataPacket[]>("SELECT emp_code, name FROM employees WHERE id = ?", [employeeId]);
    if (employees.length === 0) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    const { emp_code: empCode, name } = employees[0];

    const result: FixHistoryEmployeeResult = { employee_id: employeeId, emp_code: empCode, name, saved: 0, skipped: 0, error: null };
    const parsed = parseOtHistory(tables);
    if (!parsed.recognized) {
      result.error = "The page has no OT request table";
      return NextResponse.json(result, { status: 200 });
    }
    await saveRecords(employeeId, parsed.records);
    result.saved = parsed.records.length;
    result.skipped = parsed.skipped;
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("POST /api/timemint/ot-history failed:", error);
    return NextResponse.json({ error: "Failed to save OT request history" }, { status: 500 });
  }
}
