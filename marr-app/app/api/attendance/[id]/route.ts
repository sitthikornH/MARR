import { NextResponse } from "next/server";
import { execute, query, type RowDataPacket } from "@/lib/db";
import type { ApiError, Attendance } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  { params }: RouteParams
): Promise<NextResponse<Attendance | ApiError>> {
  try {
    const { id } = await params;
    const attendanceId = Number(id);

    if (!Number.isInteger(attendanceId)) {
      return NextResponse.json({ error: "Invalid attendance id" }, { status: 400 });
    }

    const rows = await query<RowDataPacket[]>(
      "SELECT id, employee_id, date, time_in, time_out, location_name, leave_type, created_at FROM attendance WHERE id = ?",
      [attendanceId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Attendance record not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0] as Attendance, { status: 200 });
  } catch (error) {
    console.error("GET /api/attendance/[id] failed:", error);
    return NextResponse.json({ error: "Failed to fetch attendance record" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteParams
): Promise<NextResponse<{ success: true } | ApiError>> {
  try {
    const { id } = await params;
    const attendanceId = Number(id);

    if (!Number.isInteger(attendanceId)) {
      return NextResponse.json({ error: "Invalid attendance id" }, { status: 400 });
    }

    const result = await execute("DELETE FROM attendance WHERE id = ?", [attendanceId]);

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Attendance record not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/attendance/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete attendance record" }, { status: 500 });
  }
}
