import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { monthRange, runCompanyImport } from "@/lib/companyImport";
import type { ApiError, CompanyImportResult } from "@/lib/types";

/**
 * POST { month, year } (admin): imports and saves every employee's TimeMint attendance for the
 * month in one go (one GetByCom call per TimeMint API), replacing their rows for that month.
 */
export async function POST(request: NextRequest): Promise<NextResponse<CompanyImportResult | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { month?: unknown; year?: unknown };
  const month = Number(body.month);
  const year = Number(body.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
    return NextResponse.json({ error: "month (1-12) and year are required" }, { status: 400 });
  }

  try {
    const [start, end] = monthRange(year, month);
    return NextResponse.json(await runCompanyImport(start, end), { status: 200 });
  } catch (error) {
    console.error("POST /api/timemint/attendance/all failed:", error);
    const message = error instanceof Error ? error.message : "Failed to import attendance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
