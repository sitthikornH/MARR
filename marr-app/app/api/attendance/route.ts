import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import type { ApiError, Attendance, NewAttendance } from "@/lib/types";

export async function GET(request: NextRequest): Promise<NextResponse<Attendance[] | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get("employee_id");
    const month = searchParams.get("month");
    const year = searchParams.get("year");

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (employeeId) {
      if (!Number.isInteger(Number(employeeId))) {
        return NextResponse.json({ error: "Invalid employee_id" }, { status: 400 });
      }
      conditions.push("employee_id = ?");
      values.push(Number(employeeId));
    }

    if (month) {
      if (!Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12) {
        return NextResponse.json({ error: "Invalid month" }, { status: 400 });
      }
      conditions.push("MONTH(date) = ?");
      values.push(Number(month));
    }

    if (year) {
      if (!Number.isInteger(Number(year))) {
        return NextResponse.json({ error: "Invalid year" }, { status: 400 });
      }
      conditions.push("YEAR(date) = ?");
      values.push(Number(year));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await query<RowDataPacket[]>(
      `SELECT id, employee_id, date, time_in, time_out, location_name, leave_type, created_at
       FROM attendance ${whereClause}
       ORDER BY date DESC, id DESC`,
      values
    );

    return NextResponse.json(rows as Attendance[], { status: 200 });
  } catch (error) {
    console.error("GET /api/attendance failed:", error);
    return NextResponse.json({ error: "Failed to fetch attendance records" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<Attendance | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const body = (await request.json()) as Partial<NewAttendance>;
    const { employee_id, date, time_in, time_out, location_name, leave_type } = body;

    if (!employee_id || !date) {
      return NextResponse.json({ error: "employee_id and date are required" }, { status: 400 });
    }

    const result = await execute(
      "INSERT INTO attendance (employee_id, date, time_in, time_out, location_name, leave_type) VALUES (?, ?, ?, ?, ?, ?)",
      [employee_id, date, time_in ?? null, time_out ?? null, location_name ?? null, leave_type ?? null]
    );

    const rows = await query<RowDataPacket[]>(
      "SELECT id, employee_id, date, time_in, time_out, location_name, leave_type, created_at FROM attendance WHERE id = ?",
      [result.insertId]
    );

    return NextResponse.json(rows[0] as Attendance, { status: 201 });
  } catch (error) {
    console.error("POST /api/attendance failed:", error);
    return NextResponse.json({ error: "Failed to create attendance record" }, { status: 500 });
  }
}
