import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute } from "@/lib/db";
import type { ApiError } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RouteParams {
  params: Promise<{ date: string }>;
}

/** DELETE (admin) — removes one company holiday by date. */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<{ success: true } | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const { date } = await params;
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const result = await execute("DELETE FROM company_holidays WHERE date = ?", [date]);
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Company holiday not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/company-holidays/[date] failed:", error);
    return NextResponse.json({ error: "Failed to delete company holiday" }, { status: 500 });
  }
}
