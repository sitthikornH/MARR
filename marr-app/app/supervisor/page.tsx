"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Employee } from "@/lib/types";

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i).toLocaleString("en-US", { month: "long" })
);

const employeeLabel = (employee: Employee) => `${employee.emp_code} - ${employee.name}`;

/** Landing page for role='supervisor': pick one of the employees assigned to them, then open one
 *  of the three forms they're allowed to view (lib/auth.ts canAccessSupervisedEmployee). */
export default function SupervisorPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search);
    if (initial.get("month")) setMonth(initial.get("month")!);
    if (initial.get("year")) setYear(initial.get("year")!);
    const selectedId = initial.get("employee_id") ?? "";
    if (selectedId) setEmployeeId(selectedId);

    fetch("/api/employees")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Employee[]) => {
        setEmployees(list);
        const match = list.find((employee) => String(employee.id) === selectedId);
        if (match) setEmployeeQuery(employeeLabel(match));
      })
      .catch(() => {});
  }, []);

  function handleEmployeeQueryChange(value: string) {
    setEmployeeQuery(value);
    const match = employees.find((employee) => employeeLabel(employee) === value);
    setEmployeeId(match ? String(match.id) : "");
  }

  function handleOpenForm(path: string) {
    setError(null);
    if (!employeeId) {
      setError("Please select an employee.");
      return;
    }
    const params = new URLSearchParams({ employee_id: employeeId, month, year });
    router.push(`${path}?${params.toString()}`);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Supervisor</h1>
        <p className="mt-1 text-sm text-gray-500">View TimeMint, OT, and Fixed Time Request for your assigned employees.</p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Employee</label>
            <input
              type="text"
              list="supervisor-employee-options"
              value={employeeQuery}
              onChange={(e) => handleEmployeeQueryChange(e.target.value)}
              placeholder="Type employee code or name..."
              autoComplete="off"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
            <datalist id="supervisor-employee-options">
              {employees.map((employee) => (
                <option key={employee.id} value={employeeLabel(employee)} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
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
              onChange={(e) => setYear(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleOpenForm("/welfare/timemint")}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            TimeMint
          </button>
          <button
            onClick={() => handleOpenForm("/welfare/ot")}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            OT &amp; Work on holiday
          </button>
          <button
            onClick={() => handleOpenForm("/welfare/fixed-time")}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Fixed Time Request
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && employees.length === 0 && (
            <p className="text-sm text-gray-500">No employees are assigned to you yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
