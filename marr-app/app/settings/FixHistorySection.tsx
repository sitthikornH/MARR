"use client";

import { useEffect, useState } from "react";
import type { Employee, FixHistoryImportResult, TimeMintWebSessionStatus } from "@/lib/types";

/** Settings > pick employees and read their time adjustment history from TimeMint's website. */
export default function FixHistorySection() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [windowOpen, setWindowOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FixHistoryImportResult | null>(null);

  useEffect(() => {
    fetch("/api/employees")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load employees");
        setEmployees((await res.json()) as Employee[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong"));
    fetch("/api/timemint/web-session")
      .then((res) => (res.ok ? res.json() : { open: false }))
      .then((data: TimeMintWebSessionStatus) => setWindowOpen(data.open))
      .catch(() => {});
  }, []);

  async function changeWindow(method: "POST" | "DELETE") {
    setOpening(true);
    setError(null);
    try {
      const res = await fetch("/api/timemint/web-session", { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change the TimeMint window");
      setWindowOpen((data as TimeMintWebSessionStatus).open);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setOpening(false);
    }
  }

  async function handleFetch() {
    setFetching(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/timemint/fix-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_ids: [...selected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Fetch failed");
      setResult(data as FixHistoryImportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setFetching(false);
    }
  }

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const allSelected = employees.length > 0 && selected.size === employees.length;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Time Adjustment History (TimeMint website)</h2>
        <p className="mt-1 text-sm text-gray-500">
          Reads each selected employee&apos;s &quot;ประวัติปรับปรุงเวลา&quot; page and saves it for the Fixed Time Request
          report. Earlier records are kept. Open the TimeMint window and log in there first: your normal browser&apos;s
          login can&apos;t be used, and closing the window ends this login.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => changeWindow("POST")}
          disabled={opening}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          {windowOpen ? "Show TimeMint window" : "1. Open TimeMint window"}
        </button>
        {windowOpen && (
          <button
            onClick={() => changeWindow("DELETE")}
            disabled={opening || fetching}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Close window
          </button>
        )}
        <span className={`text-sm ${windowOpen ? "text-green-700" : "text-gray-500"}`}>
          {windowOpen ? "Window open: log in there, then continue below." : "Window closed."}
        </span>
      </div>

      <div className="rounded-md border border-gray-200">
        <label className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(employees.map((e) => e.id)))}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className="text-sm font-medium text-gray-700">Select all ({employees.length})</span>
        </label>
        <div className="max-h-64 divide-y divide-gray-100 overflow-y-auto">
          {employees.map((e) => (
            <label key={e.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => toggle(e.id)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm text-gray-900">{e.name}</span>
              <span className="text-xs text-gray-500">{e.emp_code}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={handleFetch}
        disabled={fetching || !windowOpen || selected.size === 0}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        {fetching ? "Fetching..." : `2. Fetch selected (${selected.size})`}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <ul className="space-y-1 text-sm">
          {result.employees.map((e) => (
            <li key={e.employee_id} className={e.error ? "text-red-600" : "text-gray-700"}>
              {e.name} ({e.emp_code}):{" "}
              {e.error ?? `${e.saved} record(s) saved${e.skipped > 0 ? `, ${e.skipped} row(s) could not be read` : ""}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
