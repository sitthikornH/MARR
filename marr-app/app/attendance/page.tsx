"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { Attendance, Employee, LocationRate, NewAttendance } from "@/lib/types";

const EMPTY_FORM: NewAttendance = {
  employee_id: 0,
  date: "",
  time_in: "",
  time_out: "",
  location_name: "",
  leave_type: "",
};

export default function AttendancePage() {
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<LocationRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterEmployeeId, setFilterEmployeeId] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterYear, setFilterYear] = useState("");

  const [form, setForm] = useState<NewAttendance>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadAttendance() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterEmployeeId) params.set("employee_id", filterEmployeeId);
      if (filterMonth) params.set("month", filterMonth);
      if (filterYear) params.set("year", filterYear);

      const res = await fetch(`/api/attendance?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load attendance records");
      const data: Attendance[] = await res.json();
      setAttendance(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function loadReferenceData() {
      try {
        const [employeesRes, locationsRes] = await Promise.all([
          fetch("/api/employees"),
          fetch("/api/locations"),
        ]);
        if (employeesRes.ok) setEmployees(await employeesRes.json());
        if (locationsRes.ok) setLocations(await locationsRes.json());
      } catch {
        // Reference data is non-critical; the page still works without it.
      }
    }
    loadReferenceData();
  }, []);

  useEffect(() => {
    loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEmployeeId, filterMonth, filterYear]);

  function employeeLabel(employeeId: number) {
    const employee = employees.find((e) => e.id === employeeId);
    return employee ? `${employee.emp_code} - ${employee.name}` : `#${employeeId}`;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (!form.employee_id || !form.date) {
      setFormError("Employee and date are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          time_in: form.time_in || null,
          time_out: form.time_out || null,
          location_name: form.location_name || null,
          leave_type: form.leave_type || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create attendance record");
      }

      setForm(EMPTY_FORM);
      await loadAttendance();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Attendance</h1>
          <p className="mt-1 text-sm text-gray-500">Record and review daily attendance.</p>
        </div>
        <Link
          href="/attendance/import"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        >
          Import from TimeMint
        </Link>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Add Attendance Record</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Employee</label>
            <select
              value={form.employee_id || ""}
              onChange={(e) => setForm({ ...form, employee_id: Number(e.target.value) })}
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
            <label className="text-xs font-medium text-gray-600">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Time In</label>
            <input
              type="time"
              value={form.time_in ?? ""}
              onChange={(e) => setForm({ ...form, time_in: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Time Out</label>
            <input
              type="time"
              value={form.time_out ?? ""}
              onChange={(e) => setForm({ ...form, time_out: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Location</label>
            <select
              value={form.location_name ?? ""}
              onChange={(e) => setForm({ ...form, location_name: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="">None</option>
              {locations.map((location) => (
                <option key={location.id} value={location.location_name}>
                  {location.location_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Leave Type</label>
            <input
              type="text"
              value={form.leave_type ?? ""}
              onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
              placeholder="e.g. Sick"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-6 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {submitting ? "Adding..." : "Add Record"}
            </button>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Filters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Employee</label>
            <select
              value={filterEmployeeId}
              onChange={(e) => setFilterEmployeeId(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="">All employees</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.emp_code} - {employee.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Month</label>
            <select
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="">All months</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1).toLocaleString("en-US", { month: "long" })}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Year</label>
            <input
              type="number"
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              placeholder="e.g. 2026"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Time In</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Time Out</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Leave</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Loading attendance records...
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-red-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && attendance.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    No attendance records found.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                attendance.map((record) => (
                  <tr key={record.id}>
                    <td className="px-4 py-3 text-gray-700">{record.date}</td>
                    <td className="px-4 py-3 text-gray-700">{employeeLabel(record.employee_id)}</td>
                    <td className="px-4 py-3 text-gray-700">{record.time_in ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{record.time_out ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{record.location_name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{record.leave_type ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
