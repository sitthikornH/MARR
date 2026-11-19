"use client";

import { useEffect, useState } from "react";
import type { AppSettings, EmployeeSyncResult } from "@/lib/types";

const INTERVAL_LABELS: { value: number; label: string }[] = [
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 180, label: "Every 3 hours" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Once a day" },
];

interface Props {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
  onReload: () => Promise<void>;
}

/** Settings > automatic employee import from TimeMint (see lib/syncScheduler.ts). Hidden from the
 *  Settings page per the user's 2026-11-19 decision: auto sync stays on in the background (new
 *  employees are added automatically, with zero welfare rates) without an admin-facing toggle. */
export default function EmployeeSyncSection({ settings, onSaved, onReload }: Props) {
  const [enabled, setEnabled] = useState(settings.auto_sync_enabled);
  const [interval, setIntervalMinutes] = useState(settings.sync_interval_minutes);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(settings.auto_sync_enabled);
    setIntervalMinutes(settings.sync_interval_minutes);
  }, [settings.auto_sync_enabled, settings.sync_interval_minutes]);

  const dirty = enabled !== settings.auto_sync_enabled || interval !== settings.sync_interval_minutes;

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_sync_enabled: enabled, sync_interval_minutes: interval }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save settings");
      onSaved(data as AppSettings);
      setSaveMessage("Settings saved.");
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/employees/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const result = data as EmployeeSyncResult;
      setSyncMessage(
        `Fetched ${result.fetched}: ${result.inserted} new, ${result.updated} updated, ${result.skipped} unchanged, ${result.ignored} ignored, ${result.accounts_created} login account(s) created.`
      );
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSyncing(false);
      await onReload();
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Employee Sync</h2>
        <p className="mt-1 text-sm text-gray-500">
          Import employees from TimeMint. New employees are added with zero welfare rates; existing rates are
          kept. Resigned or suspended employees are ignored.
        </p>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        <span className="text-sm font-medium text-gray-900">Enable automatic sync</span>
      </label>

      <div className="flex flex-col gap-1 max-w-xs">
        <label className="text-xs font-medium text-gray-600">Sync frequency</label>
        <select
          value={interval}
          onChange={(e) => setIntervalMinutes(Number(e.target.value))}
          disabled={!enabled}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-100 disabled:text-gray-400"
        >
          {INTERVAL_LABELS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "Sync now"}
        </button>
        {saveMessage && <p className="text-sm text-gray-600">{saveMessage}</p>}
      </div>

      {syncMessage && <p className="text-sm text-gray-600">{syncMessage}</p>}

      <div className="border-t border-gray-100 pt-4 text-sm">
        <p className="text-gray-500">
          Last sync: <span className="text-gray-900">{settings.last_sync_at ?? "Never"}</span>
          {settings.last_sync_status && (
            <span
              className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${
                settings.last_sync_status === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              }`}
            >
              {settings.last_sync_status}
            </span>
          )}
        </p>
        {settings.last_sync_message && <p className="mt-1 text-gray-500">{settings.last_sync_message}</p>}
      </div>
    </section>
  );
}
