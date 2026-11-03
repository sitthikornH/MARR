import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execute } from "@/lib/db";
import { getSettings, SYNC_INTERVAL_OPTIONS } from "@/lib/employeeSync";
import type { ApiError, AppSettings, AppSettingsUpdate } from "@/lib/types";

export async function GET(request: NextRequest): Promise<NextResponse<AppSettings | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json(await getSettings(), { status: 200 });
  } catch (error) {
    console.error("GET /api/settings failed:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse<AppSettings | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;
  try {
    const body = (await request.json()) as Partial<AppSettingsUpdate>;
    const { auto_sync_enabled, sync_interval_minutes } = body;

    if (typeof auto_sync_enabled !== "boolean" || !SYNC_INTERVAL_OPTIONS.includes(Number(sync_interval_minutes))) {
      return NextResponse.json(
        { error: `auto_sync_enabled (boolean) and sync_interval_minutes (one of ${SYNC_INTERVAL_OPTIONS.join(", ")}) are required` },
        { status: 400 }
      );
    }

    const enabled: number = auto_sync_enabled ? 1 : 0;
    const interval: number = Number(sync_interval_minutes);
    await execute(
      "INSERT INTO app_settings (id, auto_sync_enabled, sync_interval_minutes) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE auto_sync_enabled = VALUES(auto_sync_enabled), sync_interval_minutes = VALUES(sync_interval_minutes)",
      [enabled, interval]
    );

    return NextResponse.json(await getSettings(), { status: 200 });
  } catch (error) {
    console.error("PUT /api/settings failed:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
