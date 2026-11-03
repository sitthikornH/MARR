import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import type { ApiError, AuthUser } from "@/lib/types";

/** GET: the signed-in user (401 when not signed in). */
export async function GET(request: NextRequest): Promise<NextResponse<AuthUser | ApiError>> {
  try {
    const auth = await getAuth(request);
    if (!auth) return NextResponse.json({ error: "Please log in" }, { status: 401 });
    return NextResponse.json(auth, { status: 200 });
  } catch (error) {
    console.error("GET /api/auth/me failed:", error);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }
}
