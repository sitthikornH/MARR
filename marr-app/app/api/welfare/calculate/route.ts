import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import type { ApiError, WelfareCalculateRequest, WelfareCalculateResult } from "@/lib/types";

const STANDARD_CHECKOUT_HOUR = 17; // 17:00 is the standard check-out time
const STANDARD_HOURS_PER_DAY = 8;
const RETURN_HOME_THRESHOLD = 0.8; // 80% of standard monthly working hours

interface EmployeeRow extends RowDataPacket {
  id: number;
  base_allowance: number;
  base_ot_rate: number;
  return_home_rate: number;
}

interface AttendanceWithFeeRow extends RowDataPacket {
  id: number;
  time_in: string | null;
  time_out: string | null;
  location_name: string | null;
  leave_type: string | null;
  travel_fee: number | null;
}

function timeStringToHours(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h + m / 60 + (s ?? 0) / 3600;
}

/** Standard monthly working hours = 8 hours * number of weekdays (Mon-Fri) in the month. */
function standardMonthlyHours(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let weekdays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) weekdays++;
  }
  return weekdays * STANDARD_HOURS_PER_DAY;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<WelfareCalculateResult | ApiError>> {
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
      `SELECT a.id, a.time_in, a.time_out, a.location_name, a.leave_type, lr.travel_fee
       FROM attendance a
       LEFT JOIN location_rates lr ON a.location_name = lr.location_name
       WHERE a.employee_id = ? AND YEAR(a.date) = ? AND MONTH(a.date) = ?`,
      [employeeId, yearNum, monthNum]
    );

    // Rule 1: Allowance - valid days have both time_in and time_out, and no leave_type.
    const validDays = attendanceRows.filter(
      (row) => row.time_in !== null && row.time_out !== null && row.leave_type === null
    );
    const totalAllowance = validDays.length * Number(employee.base_allowance);

    // Rule 2: Travel fee - sum travel_fee for every record whose location matches location_rates.
    const totalTravel = attendanceRows.reduce(
      (sum, row) => sum + (row.travel_fee !== null ? Number(row.travel_fee) : 0),
      0
    );

    // Rule 3: Overtime - hours worked past the standard 17:00 check-out time.
    let totalOtHours = 0;
    let totalWorkedHours = 0;
    for (const row of validDays) {
      const inHours = timeStringToHours(row.time_in as string);
      const outHours = timeStringToHours(row.time_out as string);
      const workedHours = Math.max(0, outHours - inHours);
      totalWorkedHours += workedHours;
      if (outHours > STANDARD_CHECKOUT_HOUR) {
        totalOtHours += outHours - STANDARD_CHECKOUT_HOUR;
      }
    }
    const totalOt = totalOtHours * Number(employee.base_ot_rate);

    // Rule 4: Return home bonus - awarded if total worked hours >= 80% of standard monthly hours.
    const standardHours = standardMonthlyHours(yearNum, monthNum);
    const totalReturnHome =
      standardHours > 0 && totalWorkedHours / standardHours >= RETURN_HOME_THRESHOLD
        ? Number(employee.return_home_rate)
        : 0;

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
