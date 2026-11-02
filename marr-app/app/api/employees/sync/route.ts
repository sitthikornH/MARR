import { NextResponse } from "next/server";
import { runEmployeeSync } from "@/lib/employeeSync";
import type { ApiError, EmployeeSyncResult } from "@/lib/types";

export async function POST(): Promise<NextResponse<EmployeeSyncResult | ApiError>> {
  try {
    const result = await runEmployeeSync();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("POST /api/employees/sync failed:", error);
    const message = error instanceof Error ? error.message : "Failed to sync employees";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
