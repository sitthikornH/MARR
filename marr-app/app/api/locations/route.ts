import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { query, type RowDataPacket } from "@/lib/db";
import type { ApiError, LocationRate } from "@/lib/types";

export async function GET(request: NextRequest): Promise<NextResponse<LocationRate[] | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT id, location_name, travel_fee FROM location_rates ORDER BY location_name ASC"
    );
    return NextResponse.json(rows as LocationRate[], { status: 200 });
  } catch (error) {
    console.error("GET /api/locations failed:", error);
    return NextResponse.json({ error: "Failed to fetch location rates" }, { status: 500 });
  }
}
