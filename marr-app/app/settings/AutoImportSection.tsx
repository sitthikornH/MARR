"use client";

import { useEffect, useState } from "react";
import type { AppSettings, CompanyImportResult } from "@/lib/types";

const HOUR_OPTIONS: { value: number; label: string }[] = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, "0")}:00`,
}));

interface Props {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
  onReload: () => Promise<void>;
}

/** Settings > automatic company-wide attendance import (see lib/syncScheduler.ts). */
export default function AutoImportSection({ settings, onSaved, onReload }: Props) {
  const [enabled, setEnabled] = useState(settings.auto_import_enabled);
  const [hour, setHour] = useState(settings.import_hour);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(settings.auto_import_enabled);
    setHour(settings.import_hour);
  }, [settings.auto_import_enabled, settings.import_hour]);

  const dirty = enabled !== settings.auto_import_enabled || hour !== settings.import_hour;

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_import_enabled: enabled, import_hour: hour }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save settings");
      onSaved(data as AppSettings);
      setMessage("Settings saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleImportNow() {
    const now = new Date();
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/timemint/attendance/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: now.getMonth() + 1, year: now.getFullYear() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      const r = data as CompanyImportResult;
      setMessage(
        `Imported ${r.employees.length} employee(s) for ${r.date_start} – ${r.date_end} in ${r.seconds}s.` +
          (r.warnings.length ? ` ${r.warnings.join(" ")}` : "")
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRunning(false);
      await onReload();
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Attendance Import (all employees)</h2>
        <p className="mt-1 text-sm text-gray-500">
          Imports the current month for every employee from TimeMint in one go, once a day at the time below.
          During the first 5 days of a month the previous month is imported again too, to pick up late approvals.
          Runs after the employee sync. Use &quot;Import this month now&quot; to run it on demand instead.
        </p>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        <span className="text-sm font-medium text-gray-900">Enable automatic import</span>
      </label>

      <div className="flex flex-col gap-1 max-w-xs">
        <label className="text-xs font-medium text-gray-600">Import time (once a day)</label>
        <select
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          disabled={!enabled}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-100 disabled:text-gray-400"
        >
          {HOUR_OPTIONS.map((opt) => (
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
          onClick={handleImportNow}
          disabled={running}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          {running ? "Importing..." : "Import this month now"}
        </button>
      </div>
      {message && <p className="text-sm text-gray-600">{message}</p>}

      <div className="border-t border-gray-100 pt-4 text-sm">
        <p className="text-gray-500">
          Last import: <span className="text-gray-900">{settings.last_import_at ?? "Never"}</span>
          {settings.last_import_status && (
            <span
              className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${
                settings.last_import_status === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              }`}
            >
              {settings.last_import_status}
            </span>
          )}
        </p>
        {settings.last_import_message && <p className="mt-1 text-gray-500">{settings.last_import_message}</p>}
      </div>
    </section>
  );
}
