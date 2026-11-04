"use client";

import { useState } from "react";
import type { CompanyImportResult } from "@/lib/types";

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Date(2000, i).toLocaleString("en-US", { month: "long" }));

/** Imports and saves every employee's attendance for one month with TimeMint company-wide calls. */
export default function ImportAllCard() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompanyImportResult | null>(null);

  async function handleImport() {
    if (!window.confirm(`Import and save ${MONTH_NAMES[month - 1]} ${year} for ALL employees? Their existing records for that month will be replaced.`)) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/timemint/attendance/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, year }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data as CompanyImportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">All employees — one month</h2>
        <p className="mt-1 text-sm text-gray-500">
          Fetches every employee at once from TimeMint and saves the attendance report, daily attendance and OT
          requests. Takes about 20 seconds.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Month</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <button
          onClick={handleImport}
          disabled={running}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {running ? "Importing all employees..." : "Import & save all employees"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-3 text-sm">
          <p className="text-green-700">
            Saved {result.employees.length} employee(s) for {result.date_start} – {result.date_end} in {result.seconds}s.
            {" "}Time adjustment requests: {result.time_adjustments.records_saved} saved from{" "}
            {result.time_adjustments.reports_read} report file(s)
            {result.time_adjustments.records_skipped > 0 && `, ${result.time_adjustments.records_skipped} skipped`}.
          </p>
          {result.not_in_marr.length > 0 && (
            <p className="text-amber-700">
              In TimeMint but not in MARR (run Sync now in Settings first): {result.not_in_marr.join(", ")}
            </p>
          )}
          {result.not_in_timemint.length > 0 && (
            <p className="text-gray-500">Not returned by TimeMint (skipped): {result.not_in_timemint.join(", ")}</p>
          )}
          {result.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-amber-700">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-y border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Employee</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Report rows</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Attendance days</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">OT requests</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Warnings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.employees.map((e) => (
                  <tr key={e.employee_id}>
                    <td className="px-3 py-2 text-gray-700">
                      {e.emp_code} - {e.name}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">{e.report_rows}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{e.days}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{e.overtime_requests}</td>
                    <td className="px-3 py-2 text-xs text-amber-700">
                      {e.warnings.length > 0 ? (
                        <details>
                          <summary className="cursor-pointer">{e.warnings.length} warning(s)</summary>
                          <ul className="mt-1 list-disc pl-4">
                            {e.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
