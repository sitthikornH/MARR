import { localToday, monthRange, runCompanyImport } from "@/lib/companyImport";
import { getSettings, runEmployeeSync } from "@/lib/employeeSync";

const TICK_MS = 60_000;
// During the first days of a month the previous month is re-imported too, to pick up late
// adjustments and approvals.
const PREVIOUS_MONTH_UNTIL_DAY = 5;

declare global {
  // eslint-disable-next-line no-var
  var __marrSyncTimer: NodeJS.Timeout | undefined;
}

const due = (last: string | null, intervalMinutes: number) =>
  Date.now() - (last ? new Date(last.replace(" ", "T")).getTime() : 0) >= intervalMinutes * 60_000;

async function tick(): Promise<void> {
  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    console.error("Scheduler could not read settings:", error);
    return;
  }

  // Employee sync first, so new employees (and their logins) exist before their attendance is imported.
  if (settings.auto_sync_enabled && due(settings.last_sync_at, settings.sync_interval_minutes)) {
    try {
      console.log("Auto employee sync finished:", await runEmployeeSync());
    } catch (error) {
      console.error("Auto employee sync failed:", error);
    }
  }

  if (settings.auto_import_enabled && due(settings.last_import_at, settings.import_interval_minutes)) {
    try {
      const today = localToday();
      const [year, month, day] = today.split("-").map(Number);
      const months: [number, number][] = [];
      if (day <= PREVIOUS_MONTH_UNTIL_DAY) months.push(month === 1 ? [year - 1, 12] : [year, month - 1]);
      months.push([year, month]);
      for (const [y, m] of months) {
        const [start, end] = monthRange(y, m);
        const result = await runCompanyImport(start, end);
        console.log(`Auto attendance import ${start}..${end}: ${result.employees.length} employee(s) in ${result.seconds}s`);
      }
    } catch (error) {
      console.error("Auto attendance import failed:", error);
    }
  }
}

export function startSyncScheduler(): void {
  if (globalThis.__marrSyncTimer) return;
  globalThis.__marrSyncTimer = setInterval(tick, TICK_MS);
}
