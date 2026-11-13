"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CompanyHoliday } from "@/lib/types";

/** "2026-01-01" -> "01 Jan 2026" */
function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Settings > the company's own declared holiday calendar (lib/attendanceReport.ts overrides TimeMint's own with it). */
export default function CompanyHolidaysSection() {
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/company-holidays");
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to load company holidays");
      setHolidays(data as CompanyHoliday[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (!date || !name.trim()) {
      setFormError("Date and name are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/company-holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add company holiday");
      setDate("");
      setName("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(d: string) {
    setDeletingDate(d);
    setError(null);
    try {
      const res = await fetch(`/api/company-holidays/${d}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete company holiday");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeletingDate(null);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Company Holidays</h2>
        <p className="mt-1 text-sm text-gray-500">
          The company's own declared holiday calendar. When attendance is imported, a date listed here overrides
          whatever TimeMint reports as a company holiday for that date (and counts as one even if TimeMint has
          nothing for it). Used by the Allowance Report, Mileage, and the Return Home bonus's base-days count.
        </p>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="วันขึ้นปีใหม่"
            className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {submitting ? "Adding..." : "Add"}
        </button>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
      </form>

      {loading && <p className="text-sm text-gray-500">Loading...</p>}
      {!loading && error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="max-h-96 overflow-y-auto rounded-md border border-gray-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs font-medium text-gray-600">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {holidays.map((h) => (
                <tr key={h.date}>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{formatDate(h.date)}</td>
                  <td className="px-3 py-2 text-gray-900">{h.name}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleDelete(h.date)}
                      disabled={deletingDate === h.date}
                      className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                    >
                      {deletingDate === h.date ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
              {holidays.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-gray-400">
                    No company holidays set.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
