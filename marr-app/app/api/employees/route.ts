import { NextRequest, NextResponse } from "next/server";
import { execute, query, type RowDataPacket } from "@/lib/db";
import type { ApiError, Employee, NewEmployee } from "@/lib/types";

export async function GET(): Promise<NextResponse<Employee[] | ApiError>> {
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance, base_ot_rate, return_home_rate, created_at FROM employees ORDER BY id ASC"
    );
    return NextResponse.json(rows as Employee[], { status: 200 });
  } catch (error) {
    console.error("GET /api/employees failed:", error);
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<Employee | ApiError>> {
  try {
    const body = (await request.json()) as Partial<NewEmployee>;
    const { emp_code, name, base_allowance, base_ot_rate, return_home_rate } = body;

    if (
      !emp_code ||
      !name ||
      base_allowance === undefined ||
      base_ot_rate === undefined ||
      return_home_rate === undefined
    ) {
      return NextResponse.json(
        { error: "emp_code, name, base_allowance, base_ot_rate, and return_home_rate are required" },
        { status: 400 }
      );
    }

    const result = await execute(
      "INSERT INTO employees (emp_code, name, base_allowance, base_ot_rate, return_home_rate) VALUES (?, ?, ?, ?, ?)",
      [emp_code, name, base_allowance, base_ot_rate, return_home_rate]
    );

    const rows = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, base_allowance, base_ot_rate, return_home_rate, created_at FROM employees WHERE id = ?",
      [result.insertId]
    );

    return NextResponse.json(rows[0] as Employee, { status: 201 });
  } catch (error) {
    console.error("POST /api/employees failed:", error);
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 });
  }
}
