import { NextRequest, NextResponse } from "next/server";
import { endSession } from "@/lib/auth";
import type { ApiError } from "@/lib/types";

/** POST: signs out (deletes the session and clears the cookie). */
export async function POST(request: NextRequest): Promise<NextResponse<{ success: true } | ApiError>> {
  try {
    const response = NextResponse.json({ success: true as const }, { status: 200 });
    await endSession(response, request);
    return response;
  } catch (error) {
    console.error("POST /api/auth/logout failed:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
