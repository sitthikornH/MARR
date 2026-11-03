"use client";

import { useEffect, useState } from "react";
import type { Employee, WelfareCalculateResult } from "@/lib/types";

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i).toLocaleString("en-US", { month: "long" })
);

export default function WelfareSummaryPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WelfareCalculateResult | null>(null);

  useEffect(() => {
    async function loadEmployees() {
      try {
        const res = await fetch("/api/employees");
        if (res.ok) setEmployees(await res.json());
      } catch {
        // Non-critical; the select will just be empty.
      }
    }
    loadEmployees();
  }, []);

  async function handleCalculate() {
    setError(null);
    setResult(null);

    if (!employeeId) {
      setError("Please select an employee.");
      return;
    }

    setCalculating(true);
    try {
      const res = await fetch("/api/welfare/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: Number(employeeId),
          month: Number(month),
          year: Number(year),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to calculate welfare");
      }

      setResult(data as WelfareCalculateResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCalculating(false);
    }
  }

  function handleOpenForm(path: string) {
    setError(null);
    if (!employeeId) {
      setError("Please select an employee.");
      return;
    }
    const params = new URLSearchParams({ employee_id: employeeId, month, year });
    window.open(`${path}?${params.toString()}`, "_blank");
  }

  const resultCards = result
    ? [
        { label: "Allowance", value: result.total_allowance },
        { label: "Travel", value: result.total_travel },
        { label: "Overtime", value: result.total_ot, detail: `${result.ot_hours} h (approved OT requests)` },
        {
          label: "Return Home",
          value: result.total_return_home,
          detail: `${result.work_days} / ${result.base_days} work days (half ≥ ${result.half_threshold_days}, full ≥ ${result.full_threshold_days})`,
        },
      ]
    : [];

  const total = result
    ? result.total_allowance + result.total_travel + result.total_ot + result.total_return_home
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Welfare Summary</h1>
        <p className="mt-1 text-sm text-gray-500">
          Calculate monthly welfare benefits for an employee.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Employee</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="">Select employee...</option>
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
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleCalculate}
            disabled={calculating}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {calculating ? "Calculating..." : "Calculate Welfare"}
          </button>
          <button
            onClick={() => handleOpenForm("/welfare/allowance-report")}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Allowance Report
          </button>
          <button
            onClick={() => handleOpenForm("/welfare/mileage")}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Mileage &amp; Telephone
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </section>

      {result && (
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Results — {MONTH_NAMES[result.month - 1]} {result.year}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {resultCards.map((card) => (
              <div key={card.label} className="rounded-md border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-500">{card.label}</p>
                <p className="mt-2 text-xl font-semibold text-gray-900">
                  {card.value.toFixed(2)}
                </p>
                {"detail" in card && card.detail && <p className="mt-1 text-xs text-gray-500">{card.detail}</p>}
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-gray-100 pt-4 flex justify-between items-center">
            <p className="text-sm font-medium text-gray-600">Total</p>
            <p className="text-lg font-semibold text-gray-900">{total.toFixed(2)}</p>
          </div>
        </section>
      )}
    </div>
  );
}
