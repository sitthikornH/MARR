import { getSettings, runEmployeeSync } from "@/lib/employeeSync";

const TICK_MS = 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __marrSyncTimer: NodeJS.Timeout | undefined;
}

async function tick(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.auto_sync_enabled) return;

    const intervalMs = settings.sync_interval_minutes * 60_000;
    const last = settings.last_sync_at ? new Date(settings.last_sync_at.replace(" ", "T")).getTime() : 0;
    if (Date.now() - last < intervalMs) return;

    const result = await runEmployeeSync();
    console.log("Auto employee sync finished:", result);
  } catch (error) {
    console.error("Auto employee sync failed:", error);
  }
}

export function startSyncScheduler(): void {
  if (globalThis.__marrSyncTimer) return;
  globalThis.__marrSyncTimer = setInterval(tick, TICK_MS);
}
