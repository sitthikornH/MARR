import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import type { ApiError, EmployeeGroup } from "@/lib/types";

/**
 * Named employee groups (e.g. "SUB1", "O&M"), independent of any particular supervisor login —
 * used by the Employees page's Group column and by Settings > Supervisors' per-report group access.
 */

export async function GET(request: NextRequest): Promise<NextResponse<EmployeeGroup[] | ApiError>> {
  const gate = await requireAuth(request);
  if ("response" in gate) return gate.response;
  try {
    const rows = await query<RowDataPacket[]>("SELECT id, name FROM employee_groups ORDER BY name ASC");
    return NextResponse.json(rows as EmployeeGroup[], { status: 200 });
  } catch (error) {
    console.error("GET /api/employee-groups failed:", error);
    return NextResponse.json({ error: "Failed to fetch employee groups" }, { status: 500 });
  }
}

/** POST { name } (admin): creates a new employee group. */
export async function POST(request: NextRequest): Promise<NextResponse<EmployeeGroup | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) {
      return NextResponse.json({ error: "Name must be 1-100 characters" }, { status: 400 });
    }

    const result = await execute("INSERT INTO employee_groups (name) VALUES (?)", [name]);
    return NextResponse.json({ id: result.insertId, name }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Duplicate entry")) {
      return NextResponse.json({ error: "That group name already exists" }, { status: 409 });
    }
    console.error("POST /api/employee-groups failed:", error);
    return NextResponse.json({ error: "Failed to create employee group" }, { status: 500 });
  }
}
