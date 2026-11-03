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
    const body = (await request.json()) as AppSettingsUpdate;
    const { auto_sync_enabled, sync_interval_minutes, auto_import_enabled, import_interval_minutes } = body;
    const hasSync = auto_sync_enabled !== undefined || sync_interval_minutes !== undefined;
    const hasImport = auto_import_enabled !== undefined || import_interval_minutes !== undefined;

    if (!hasSync && !hasImport) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    if (hasSync && (typeof auto_sync_enabled !== "boolean" || !SYNC_INTERVAL_OPTIONS.includes(Number(sync_interval_minutes)))) {
      return NextResponse.json(
        { error: `auto_sync_enabled (boolean) and sync_interval_minutes (one of ${SYNC_INTERVAL_OPTIONS.join(", ")}) are required` },
        { status: 400 }
      );
    }
    if (hasImport && (typeof auto_import_enabled !== "boolean" || !SYNC_INTERVAL_OPTIONS.includes(Number(import_interval_minutes)))) {
      return NextResponse.json(
        { error: `auto_import_enabled (boolean) and import_interval_minutes (one of ${SYNC_INTERVAL_OPTIONS.join(", ")}) are required` },
        { status: 400 }
      );
    }

    await execute("INSERT IGNORE INTO app_settings (id) VALUES (1)");
    if (hasSync) {
      const enabled: number = auto_sync_enabled ? 1 : 0;
      const interval: number = Number(sync_interval_minutes);
      await execute("UPDATE app_settings SET auto_sync_enabled = ?, sync_interval_minutes = ? WHERE id = 1", [enabled, interval]);
    }
    if (hasImport) {
      const enabled: number = auto_import_enabled ? 1 : 0;
      const interval: number = Number(import_interval_minutes);
      await execute("UPDATE app_settings SET auto_import_enabled = ?, import_interval_minutes = ? WHERE id = 1", [enabled, interval]);
    }

    return NextResponse.json(await getSettings(), { status: 200 });
  } catch (error) {
    console.error("PUT /api/settings failed:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
