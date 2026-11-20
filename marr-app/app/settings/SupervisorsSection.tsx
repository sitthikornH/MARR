"use client";

import { useEffect, useState } from "react";
import type { SupervisorAccount } from "@/lib/types";

/**
 * Settings > manage supervisor accounts (role='supervisor', no employee record). A supervisor can
 * view the TimeMint, OT & Work on holiday, and Fixed Time Request forms (only) for the employees
 * assigned to them on the Employees page's Supervisor column.
 */
export default function SupervisorsSection() {
  const [supervisors, setSupervisors] = useState<SupervisorAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/supervisors");
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to load supervisors");
      setSupervisors(data as SupervisorAccount[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    setError(null);
    setMessage(null);
    setCreating(true);
    try {
      const res = await fetch("/api/supervisors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create supervisor");
      setUsername("");
      setPassword("");
      setMessage(`Created "${(data as SupervisorAccount).username}".`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  async function handleResetPassword(supervisor: SupervisorAccount) {
    const temp = window.prompt(`New password for "${supervisor.username}" (at least 8 characters):`);
    if (!temp) return;
    setError(null);
    setMessage(null);
    setBusyId(supervisor.id);
    try {
      const res = await fetch(`/api/supervisors/${supervisor.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: temp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      setMessage(`Password reset for "${supervisor.username}".`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(supervisor: SupervisorAccount) {
    if (!window.confirm(`Delete supervisor "${supervisor.username}"? Employees assigned to them become unassigned.`)) {
      return;
    }
    setError(null);
    setMessage(null);
    setBusyId(supervisor.id);
    try {
      const res = await fetch(`/api/supervisors/${supervisor.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete supervisor");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Supervisors</h2>
        <p className="mt-1 text-sm text-gray-500">
          A supervisor can view TimeMint, OT &amp; Work on holiday, and Fixed Time Request for the
          employees assigned to them on the Employees page — nothing else.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. peeraya"
            className="w-48 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Password</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-48 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={creating || !username.trim() || !password}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {creating ? "Adding..." : "Add supervisor"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-700">{message}</p>}
      {loading && <p className="text-sm text-gray-500">Loading...</p>}

      {!loading && (
        <div className="rounded-md border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-600">
              <tr>
                <th className="px-3 py-2">Username</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {supervisors.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-mono text-gray-900">{s.username}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {!s.has_password && <span className="text-amber-700">no password</span>}
                    {s.locked && <span className="text-red-600">locked</span>}
                    {s.has_password && !s.locked && "ok"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleResetPassword(s)}
                      disabled={busyId === s.id}
                      className="mr-4 text-xs text-gray-600 underline disabled:opacity-50"
                    >
                      Reset password
                    </button>
                    <button
                      onClick={() => handleDelete(s)}
                      disabled={busyId === s.id}
                      className="text-xs text-red-600 underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {supervisors.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-gray-400">
                    No supervisors yet.
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
