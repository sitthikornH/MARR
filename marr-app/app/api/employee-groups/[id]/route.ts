import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute } from "@/lib/db";
import type { ApiError, EmployeeGroup } from "@/lib/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** PUT { name } (admin): renames an employee group. */
export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse<EmployeeGroup | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) {
      return NextResponse.json({ error: "Name must be 1-100 characters" }, { status: 400 });
    }

    const result = await execute("UPDATE employee_groups SET name = ? WHERE id = ?", [name, id]);
    if (result.affectedRows === 0) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    return NextResponse.json({ id, name }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Duplicate entry")) {
      return NextResponse.json({ error: "That group name already exists" }, { status: 409 });
    }
    console.error("PUT /api/employee-groups/[id] failed:", error);
    return NextResponse.json({ error: "Failed to rename employee group" }, { status: 500 });
  }
}

/** DELETE (admin): removes the group. Employees in it, and supervisors scoped to it, become unassigned. */
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse<{ success: true } | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const result = await execute("DELETE FROM employee_groups WHERE id = ?", [id]);
    if (result.affectedRows === 0) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/employee-groups/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete employee group" }, { status: 500 });
  }
}
