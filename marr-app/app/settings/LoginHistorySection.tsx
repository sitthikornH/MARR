"use client";

import { useEffect, useState } from "react";
import type { LoginHistoryRow } from "@/lib/types";

const EVENT_LABELS: Record<string, string> = { login: "Login", logout: "Logout" };

/** "2026-11-10 09:05:00" -> "10 Nov 2026, 09:05" */
function formatDateTime(value: string): string {
  return new Date(value.replace(" ", "T")).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Settings > search the login/logout history recorded by lib/auth.ts. */
export default function LoginHistorySection() {
  const [rows, setRows] = useState<LoginHistoryRow[]>([]);
  const [q, setQ] = useState("");
  const [eventFilter, setEventFilter] = useState<"" | "login" | "logout">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (eventFilter) params.set("event", eventFilter);
        const res = await fetch(`/api/login-history?${params.toString()}`, { signal: controller.signal });
        const data = await res.json().catch(() => []);
        if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to load login history");
        setRows(data as LoginHistoryRow[]);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, eventFilter]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Login History</h2>
        <p className="mt-1 text-sm text-gray-500">
          Every sign-in and sign-out, including the automatic sign-out after 30 minutes idle.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Search</label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Username or employee name"
            className="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Event</label>
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value as "" | "login" | "logout")}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <option value="">All</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
          </select>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading...</p>}
      {!loading && error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="max-h-96 overflow-y-auto rounded-md border border-gray-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs font-medium text-gray-600">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{formatDateTime(r.created_at)}</td>
                  <td className="px-3 py-2 text-gray-900">
                    {r.employee_name ?? r.username}{" "}
                    <span className="text-xs text-gray-500">({r.username})</span>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{r.role}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        r.event === "login" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {EVENT_LABELS[r.event] ?? r.event}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-gray-400">
                    No matching records.
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
