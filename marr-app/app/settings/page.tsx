"use client";

import { useEffect, useState } from "react";
import type { AppSettings, EmployeeSyncResult } from "@/lib/types";
import AutoImportSection from "./AutoImportSection";

const INTERVAL_LABELS: { value: number; label: string }[] = [
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 180, label: "Every 3 hours" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Once a day" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [interval, setIntervalMinutes] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  function applySettings(data: AppSettings) {
    setSettings(data);
    setEnabled(data.auto_sync_enabled);
    setIntervalMinutes(data.sync_interval_minutes);
  }

  async function loadSettings() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      applySettings(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

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
      applySettings(data);
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
      await loadSettings();
    }
  }

  const dirty =
    settings !== null &&
    (enabled !== settings.auto_sync_enabled || interval !== settings.sync_interval_minutes);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">System configuration.</p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Employee Sync</h2>
          <p className="mt-1 text-sm text-gray-500">
            Import employees from TimeMint. New employees are added with zero welfare rates; existing rates are
            kept. Resigned or suspended employees are ignored.
          </p>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading settings...</p>}
        {!loading && error && <p className="text-sm text-red-600">{error}</p>}

        {!loading && !error && settings && (
          <>
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
                Last sync:{" "}
                <span className="text-gray-900">{settings.last_sync_at ?? "Never"}</span>
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
          </>
        )}
      </section>

      {settings && (
        <AutoImportSection settings={settings} intervals={INTERVAL_LABELS} onSaved={applySettings} onReload={loadSettings} />
      )}
    </div>
  );
}
