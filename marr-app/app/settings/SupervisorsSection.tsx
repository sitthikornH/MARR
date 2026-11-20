"use client";

import { useEffect, useState } from "react";
import type { ReportScope, SupervisorAccount, SupervisorPermissionsUpdate } from "@/lib/types";

const SCOPE_OPTIONS: { value: ReportScope; label: string }[] = [
  { value: "own", label: "Group#" },
  { value: "all", label: "ALL Group" },
];

function permissionsOf(s: SupervisorAccount): SupervisorPermissionsUpdate {
  return {
    can_manage_employees: s.can_manage_employees,
    can_manage_time_adjustment_history: s.can_manage_time_adjustment_history,
    timemint_scope: s.timemint_scope,
    ot_scope: s.ot_scope,
    fixed_time_scope: s.fixed_time_scope,
  };
}

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

  async function handlePermissionChange(supervisor: SupervisorAccount, patch: Partial<SupervisorPermissionsUpdate>) {
    setError(null);
    setBusyId(supervisor.id);
    // Optimistic update so a select/checkbox doesn't visibly revert while the request is in flight.
    const next = { ...permissionsOf(supervisor), ...patch };
    setSupervisors((list) => list.map((s) => (s.id === supervisor.id ? { ...s, ...next } : s)));
    try {
      const res = await fetch(`/api/supervisors/${supervisor.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update permissions");
      setSupervisors((list) => list.map((s) => (s.id === supervisor.id ? (data as SupervisorAccount) : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      await load();
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
          A supervisor always sees TimeMint, OT &amp; Work on holiday, and Fixed Time Request for the
          employees assigned to them on the Employees page. The permissions below are independent
          toggles an admin picks per account — set them to match any position (e.g. ADMIN-HR,
          ADMIN-ACC, ADMIN-Project).
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
                <th className="px-3 py-2 text-center">Employees</th>
                <th className="px-3 py-2 text-center">Time Adj. &amp; OT History</th>
                <th className="px-3 py-2 text-center">TimeMint</th>
                <th className="px-3 py-2 text-center">SheetOver Time</th>
                <th className="px-3 py-2 text-center">Sheet fixed time request</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {supervisors.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-mono text-gray-900">{s.username}</td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={s.can_manage_employees}
                      disabled={busyId === s.id}
                      onChange={(e) => handlePermissionChange(s, { can_manage_employees: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={s.can_manage_time_adjustment_history}
                      disabled={busyId === s.id}
                      onChange={(e) =>
                        handlePermissionChange(s, { can_manage_time_adjustment_history: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <select
                      value={s.timemint_scope}
                      disabled={busyId === s.id}
                      onChange={(e) => handlePermissionChange(s, { timemint_scope: e.target.value as ReportScope })}
                      className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                    >
                      {SCOPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <select
                      value={s.ot_scope}
                      disabled={busyId === s.id}
                      onChange={(e) => handlePermissionChange(s, { ot_scope: e.target.value as ReportScope })}
                      className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                    >
                      {SCOPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <select
                      value={s.fixed_time_scope}
                      disabled={busyId === s.id}
                      onChange={(e) => handlePermissionChange(s, { fixed_time_scope: e.target.value as ReportScope })}
                      className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                    >
                      {SCOPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
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
                  <td colSpan={8} className="px-3 py-4 text-center text-gray-400">
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
