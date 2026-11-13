import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import type { ApiError, CompanyHoliday } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_MAX = 255;

interface HolidayRow extends RowDataPacket, CompanyHoliday {}

/** GET (admin) — every company holiday, earliest first. */
export async function GET(request: NextRequest): Promise<NextResponse<CompanyHoliday[] | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const rows = await query<HolidayRow[]>("SELECT date, name FROM company_holidays ORDER BY date ASC");
    return NextResponse.json(rows, { status: 200 });
  } catch (error) {
    console.error("GET /api/company-holidays failed:", error);
    return NextResponse.json({ error: "Failed to fetch company holidays" }, { status: 500 });
  }
}

/** POST { date, name } (admin) — add or rename a company holiday (upserts on date). */
export async function POST(request: NextRequest): Promise<NextResponse<CompanyHoliday | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const body = (await request.json()) as Partial<CompanyHoliday>;
    const { date, name } = body;

    if (!date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
    }
    if (!name || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const trimmedName: string = name.trim().slice(0, NAME_MAX);

    await execute(
      "INSERT INTO company_holidays (date, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
      [date, trimmedName]
    );

    return NextResponse.json({ date, name: trimmedName }, { status: 201 });
  } catch (error) {
    console.error("POST /api/company-holidays failed:", error);
    return NextResponse.json({ error: "Failed to save company holiday" }, { status: 500 });
  }
}
