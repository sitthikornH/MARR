"use client";

import { useEffect, useRef, useState } from "react";
import { buildBookmarklet, TIMEMINT_ORIGIN } from "@/lib/fixHistoryBookmarklet";
import type { Employee, FixHistoryEmployeeResult } from "@/lib/types";

/**
 * Settings > pick employees, open TimeMint in this browser and read their time adjustment history with
 * a bookmark. The bookmark runs in TimeMint's tab and sends each page here over postMessage, because a
 * MARR page isn't allowed to read another site's tab itself.
 */
export default function FixHistorySection() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FixHistoryEmployeeResult[]>([]);

  const bookmarkRef = useRef<HTMLAnchorElement>(null);
  const tabRef = useRef<Window | null>(null);
  // The message listener outlives renders, so it reads the current values from here.
  const latest = useRef({ employees, selected });
  latest.current = { employees, selected };

  useEffect(() => {
    fetch("/api/employees")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load employees");
        setEmployees((await res.json()) as Employee[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong"));
  }, []);

  // Set here because React refuses to render a javascript: address.
  useEffect(() => {
    bookmarkRef.current?.setAttribute("href", buildBookmarklet(window.location.origin));
  }, []);

  useEffect(() => {
    const nameOf = (id: number) => {
      const emp = latest.current.employees.find((e) => e.id === id);
      return { emp_code: emp?.emp_code ?? String(id), name: emp?.name ?? String(id) };
    };

    async function savePage(employeeId: number, tables: unknown): Promise<FixHistoryEmployeeResult> {
      const failed = (message: string) => ({ employee_id: employeeId, ...nameOf(employeeId), saved: 0, skipped: 0, error: message });
      if (!tables) return failed("Could not read this employee's page");
      try {
        const res = await fetch("/api/timemint/fix-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employee_id: employeeId, tables }),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok ? (data as FixHistoryEmployeeResult) : failed(data.error || "Could not save this employee's history");
      } catch {
        return failed("Could not save this employee's history");
      }
    }

    // Pages are saved one at a time, in the order they arrive.
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (work: () => Promise<void> | void) => {
      queue = queue.then(work);
    };

    function onMessage(event: MessageEvent) {
      if (event.origin !== TIMEMINT_ORIGIN || !tabRef.current || event.source !== tabRef.current) return;
      const data = event.data as { type?: string; employee_id?: unknown; tables?: unknown; message?: unknown };
      if (data?.type === "marr-fix-ready") {
        const { employees: all, selected: chosen } = latest.current;
        const picked = all.filter((e) => chosen.has(e.id)).map((e) => ({ id: e.id, emp_code: e.emp_code, name: e.name }));
        setResults([]);
        setError(null);
        setRunning(picked.length > 0);
        tabRef.current.postMessage({ type: "marr-fix-employees", employees: picked }, TIMEMINT_ORIGIN);
      } else if (data?.type === "marr-fix-page" && Number.isInteger(data.employee_id)) {
        const employeeId = data.employee_id as number;
        enqueue(async () => {
          const result = await savePage(employeeId, data.tables);
          setResults((previous) => [...previous, result]);
        });
      } else if (data?.type === "marr-fix-done") {
        enqueue(() => setRunning(false));
      } else if (data?.type === "marr-fix-error") {
        enqueue(() => {
          setRunning(false);
          setError(`${String(data.message)}. Log in in the TimeMint tab, then click the bookmark again.`);
        });
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function openTimeMint() {
    setError(null);
    tabRef.current = window.open(`${TIMEMINT_ORIGIN}/`, "marr_timemint");
    if (!tabRef.current) setError("The browser blocked the new tab. Allow pop-ups for this site, then try again.");
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
          Reads each selected employee&apos;s &quot;ประวัติปรับปรุงเวลา&quot; page in your own browser and saves it for the
          Fixed Time Request report. Earlier records are kept. MARR doesn&apos;t see your TimeMint password.
        </p>
      </div>

      <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
        <p className="font-medium">First time on this computer: add the bookmark</p>
        <p className="mt-1">Show the bookmarks bar (Ctrl+Shift+B), then drag this button onto it:</p>
        <a
          ref={bookmarkRef}
          onClick={(e) => e.preventDefault()}
          className="mt-2 inline-block cursor-grab rounded-md border border-gray-400 bg-white px-3 py-1.5 font-medium text-gray-900"
        >
          MARR: Read TimeMint
        </a>
      </div>

      <div className="rounded-md border border-gray-200">
        <label className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(employees.map((e) => e.id)))}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className="text-sm font-medium text-gray-700">
            1. Select employees ({selected.size}/{employees.length})
          </span>
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

      <div className="space-y-2">
        <button
          onClick={openTimeMint}
          disabled={selected.size === 0}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          2. Open TimeMint in a new tab
        </button>
        <p className="text-sm text-gray-600">
          3. Log in there if needed, then click <span className="font-medium">MARR: Read TimeMint</span> on the bookmarks
          bar while on the TimeMint tab. Keep this page open: results appear below.
        </p>
      </div>

      {running && <p className="text-sm text-gray-600">Reading from TimeMint...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {results.length > 0 && (
        <ul className="space-y-1 text-sm">
          {results.map((e) => (
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
