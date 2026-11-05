import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { closeWindow, isWindowOpen, openWindow } from "@/lib/timemintWeb";
import type { ApiError, TimeMintWebSessionStatus } from "@/lib/types";

/** GET (admin): is the TimeMint login window open? */
export async function GET(request: NextRequest): Promise<NextResponse<TimeMintWebSessionStatus | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  return NextResponse.json({ open: isWindowOpen() }, { status: 200 });
}

/** POST (admin): opens a Chrome window on the server's desktop, for logging in to TimeMint by hand. */
export async function POST(request: NextRequest): Promise<NextResponse<TimeMintWebSessionStatus | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    await openWindow();
    return NextResponse.json({ open: true }, { status: 200 });
  } catch (error) {
    console.error("POST /api/timemint/web-session failed:", error);
    return NextResponse.json({ error: "Could not open Chrome on the server. Is Google Chrome installed?" }, { status: 500 });
  }
}

/** DELETE (admin): closes the window, which ends the TimeMint login. */
export async function DELETE(request: NextRequest): Promise<NextResponse<TimeMintWebSessionStatus | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    await closeWindow();
    return NextResponse.json({ open: false }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/timemint/web-session failed:", error);
    return NextResponse.json({ error: "Could not close the window" }, { status: 500 });
  }
}
