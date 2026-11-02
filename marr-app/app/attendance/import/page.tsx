"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { Employee, TimeMintImportResult } from "@/lib/types";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstOfMonth(): string {
  return `${today().slice(0, 8)}01`;
}

/** "2026-10-03" -> "03/10/2569" (Buddhist year, as in the TimeMint export) */
function formatThaiDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${Number(y) + 543}`;
}

function hhmm(time: string | null, empty: string): string {
  return time ? time.slice(0, 5) : empty;
}

export default function AttendanceImportPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [dateStart, setDateStart] = useState(firstOfMonth());
  const [dateEnd, setDateEnd] = useState(today());

  const [preview, setPreview] = useState<TimeMintImportResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/employees")
      .then((res) => (res.ok ? res.json() : []))
      .then(setEmployees)
      .catch(() => {});
  }, []);

  async function callImport(save: boolean): Promise<TimeMintImportResult> {
    const res = await fetch("/api/timemint/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: Number(employeeId), date_start: dateStart, date_end: dateEnd, save }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data as TimeMintImportResult;
  }

  async function handleFetch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSavedMessage(null);
    setPreview(null);

    if (!employeeId || !dateStart || !dateEnd) {
      setError("Employee, start date and end date are required.");
      return;
    }
    if (dateEnd < dateStart) {
      setError("End date must be on or after start date.");
      return;
    }

    setFetching(true);
    try {
      setPreview(await callImport(false));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const result = await callImport(true);
      setPreview(result);
      setSavedMessage(
        `Saved ${result.report_rows.length} report row(s) and ${result.days.length} attendance day(s) (replaced ${result.replaced} existing attendance record(s)).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const completeDays = preview?.days.filter((d) => d.time_in && d.time_out && !d.leave_type).length ?? 0;
  const leaveDays = preview?.days.filter((d) => d.leave_type).length ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Import from TimeMint</h1>
        <p className="mt-1 text-sm text-gray-500">
          Fetch an employee&apos;s check-ins and approved leaves for a date range, review them, then save them as
          attendance records for the welfare calculation.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <form onSubmit={handleFetch} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Employee</label>
            <select
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                setPreview(null);
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="">Select...</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.emp_code} - {employee.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Start Date</label>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => {
                setDateStart(e.target.value);
                setPreview(null);
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">End Date</label>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => {
                setDateEnd(e.target.value);
                setPreview(null);
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={fetching}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {fetching ? "Fetching..." : "Fetch from TimeMint"}
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-gray-500">Maximum range is 90 days.</p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      {preview && (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">Days found</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{preview.days.length}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">Complete work days (allowance)</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{completeDays}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500">Leave days</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{leaveDays}</p>
            </div>
          </section>

          {(preview.unmatched_locations.length > 0 || preview.warnings.length > 0) && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 space-y-2">
              {preview.unmatched_locations.length > 0 && (
                <p>
                  <span className="font-medium">No travel fee set for:</span>{" "}
                  {preview.unmatched_locations.join(", ")}. Add them to location rates or their travel fee will be 0.
                </p>
              )}
              {preview.warnings.length > 0 && (
                <ul className="list-disc pl-5 space-y-1">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
            <h2 className="px-4 pt-4 text-base font-semibold text-gray-900">Attendance report</h2>
            <p className="px-4 pb-3 text-xs text-gray-500">Same columns as the TimeMint report export.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr>
                    {[
                      "Employee ID",
                      "Employee name",
                      "Position",
                      "Date",
                      "Start work at",
                      "Get off work at",
                      "Time (in)",
                      "Time (out)",
                      "Notice",
                      "Overtime request history",
                      "Place",
                    ].map((h) => (
                      <th key={h} className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.report_rows.map((row, i) => (
                    <tr key={i} className={row.row_type === "holiday" || row.row_type === "company_holiday" ? "bg-gray-50" : ""}>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.emp_code}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.employee_name}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.position ?? ""}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatThaiDate(row.date)}</td>
                      <td className="px-3 py-2 text-gray-700">{hhmm(row.start_work_at, "-")}</td>
                      <td className="px-3 py-2 text-gray-700">{hhmm(row.get_off_work_at, "-")}</td>
                      <td className="px-3 py-2 text-gray-700">{hhmm(row.time_in, "00:00")}</td>
                      <td className="px-3 py-2 text-gray-700">{hhmm(row.time_out, "00:00")}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.notice ?? ""}</td>
                      <td className="px-3 py-2 text-gray-700 text-xs whitespace-pre-line min-w-64">
                        {row.overtime_request_history ?? ""}
                      </td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{row.place ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
            <h2 className="px-4 pt-4 text-base font-semibold text-gray-900">Daily attendance (for welfare calculation)</h2>
            <p className="px-4 pb-3 text-xs text-gray-500">
              One row per day: first check-in, last check-out, first check-in&apos;s place, and approved full-day leave.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Time In</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Time Out</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Leave</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.days.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                        No check-ins or approved leaves in this range.
                      </td>
                    </tr>
                  )}
                  {preview.days.map((day) => (
                    <tr key={day.date}>
                      <td className="px-4 py-3 text-gray-700">{day.date}</td>
                      <td className="px-4 py-3 text-gray-700">{day.time_in ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{day.time_out ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{day.location_name ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{day.leave_type ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || preview.saved}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : preview.saved ? "Saved" : "Save to Attendance"}
            </button>
            {!preview.saved && (
              <p className="text-sm text-gray-500">
                Existing report rows and attendance records for {preview.emp_code} from {preview.date_start} to{" "}
                {preview.date_end} will be replaced.
              </p>
            )}
            {savedMessage && (
              <p className="text-sm text-green-700">
                {savedMessage}{" "}
                <Link href="/welfare" className="underline">
                  Go to Welfare Summary
                </Link>
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
