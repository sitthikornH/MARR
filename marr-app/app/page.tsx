"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Employee, LocationRate } from "@/lib/types";

export default function DashboardPage() {
  const [employeeCount, setEmployeeCount] = useState<number | null>(null);
  const [locationCount, setLocationCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSummary() {
      setLoading(true);
      setError(null);
      try {
        const [employeesRes, locationsRes] = await Promise.all([
          fetch("/api/employees"),
          fetch("/api/locations"),
        ]);

        if (!employeesRes.ok || !locationsRes.ok) {
          throw new Error("Failed to load dashboard data");
        }

        const employees: Employee[] = await employeesRes.json();
        const locations: LocationRate[] = await locationsRes.json();

        setEmployeeCount(employees.length);
        setLocationCount(locations.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    loadSummary();
  }, []);

  const cards = [
    { label: "Total Employees", value: employeeCount, href: "/employees" },
    { label: "Locations", value: locationCount, href: "/attendance" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of Project MARR&apos;s HR welfare system.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <p className="text-sm font-medium text-gray-500">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">
              {loading ? "…" : card.value ?? "—"}
            </p>
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">Quick links</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link
            href="/employees"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            Manage Employees
          </Link>
          <Link
            href="/attendance"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Record Attendance
          </Link>
          <Link
            href="/welfare"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Calculate Welfare
          </Link>
        </div>
      </div>
    </div>
  );
}
