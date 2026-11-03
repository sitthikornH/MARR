"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AllowanceReport } from "@/lib/types";

const RATE_TIERS = [350, 300, 250];
const HOLIDAY_MULTIPLIER = 3.5; // 300/day -> 1,050/holiday, as on the paper form

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-07-04" -> "04/07/2026" */
function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function ReportView() {
  const params = useSearchParams();
  const employeeId = params.get("employee_id");
  const month = params.get("month");
  const year = params.get("year");

  const [report, setReport] = useState<AllowanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayRate, setDayRate] = useState(0);
  const [holidayRate, setHolidayRate] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/welfare/allowance-report?employee_id=${employeeId}&month=${month}&year=${year}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load report");
        const r = data as AllowanceReport;
        setReport(r);
        setDayRate(r.base_allowance);
        setHolidayRate(r.base_allowance * HOLIDAY_MULTIPLIER);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    }
    load();
  }, [employeeId, month, year]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!report) return <p className="text-sm text-gray-500">Loading report...</p>;

  const monthLabel = new Date(report.year, report.month - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const totalDays = report.days.filter((d) => d.kind === "work").length;
  const totalHolidays = report.days.filter((d) => d.kind === "holiday_work").length;
  const totalAllowance = totalDays * dayRate;
  const totalHolidayAllowance = totalHolidays * holidayRate;
  const grandTotal = totalAllowance + totalHolidayAllowance;
  const tiers = RATE_TIERS.includes(dayRate) ? RATE_TIERS : [...RATE_TIERS, dayRate];

  // Running count shown at the right of the Time cell: 1, 2, ... for days counted in Total Day,
  // H1, H2, ... for days counted in Total Holiday.
  let workCount = 0;
  let holidayCount = 0;
  const countLabels = report.days.map((d) =>
    d.kind === "work" ? String(++workCount) : d.kind === "holiday_work" ? `H${++holidayCount}` : null
  );
  // Work-day number at the right of the Site cell (days counted for the return-home bonus).
  let workDayCount = 0;
  const workDayLabels = report.days.map((d) => (d.work_day ? String(++workDayCount) : null));

  const remarks = [
    ...report.days
      .filter((d) => d.kind === "leave")
      .map((d) => `${longDate(d.date)} : ${d.site}`),
    ...report.days
      .filter((d) => d.kind === "holiday_work")
      .map((d) => `${longDate(d.date)} : Worked on holiday${d.note ? ` (${d.note})` : ""}`),
    ...report.days
      .filter((d) => (d.kind === "work" || d.kind === "uncounted") && d.note)
      .map((d) => `${longDate(d.date)} : ${d.note}`),
  ];

  const cell = "border border-gray-800 px-2 py-0.5";
  const missingDays = report.days.length - report.imported_days;

  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: A4; margin: 8mm; } body { background: white !important; } }`}</style>

      <div className="print:hidden flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <Link href="/welfare" className="text-sm text-gray-600 underline">
          ← Back
        </Link>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Site Allowance / Day</label>
          <input
            type="number"
            step="0.01"
            value={dayRate}
            onChange={(e) => setDayRate(Number(e.target.value))}
            className="w-36 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Site Allowance / Holiday</label>
          <input
            type="number"
            step="0.01"
            value={holidayRate}
            onChange={(e) => setHolidayRate(Number(e.target.value))}
            className="w-36 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
        >
          Print / Save PDF
        </button>
        {missingDays > 0 && (
          <p className="text-sm text-amber-700">
            {report.imported_days === 0 ? "No attendance imported for this month. " : `${missingDays} day(s) not imported. `}
            <Link href="/attendance/import" className="underline">
              Import from TimeMint
            </Link>
          </p>
        )}
      </div>

      <div className="mx-auto max-w-[210mm] bg-white p-6 text-[11px] leading-tight text-gray-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <p className="text-2xl font-black tracking-tight">ENSYS</p>
        <p className="mt-1 border border-gray-800 py-1 text-center text-sm font-bold">OTHER INCOME FOR ALLOWANCE</p>

        <div className="mt-2 grid grid-cols-2 gap-4">
          {/* Left column */}
          <div className="space-y-3">
            <table className="w-full border-collapse">
              <tbody>
                {[
                  ["Employee Name", `${report.employee_name} (${report.emp_code})`],
                  ["Position", report.position],
                  ["Department", report.department],
                  ["Direct Superior", report.direct_superior],
                  ["Site", report.site],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td className={`${cell} w-28 font-semibold`}>{label}</td>
                    <td className={cell}>{value ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="w-full border-collapse">
              <tbody>
                <tr>
                  <td className={`${cell} font-semibold`} colSpan={2}>
                    Site Allowance - Stay Over Night
                  </td>
                </tr>
                {tiers.map((t) => (
                  <tr key={t}>
                    <td className={`${cell} w-10 text-center`}>{t === dayRate ? "✓" : ""}</td>
                    <td className={cell}>THB {money(t)} / Day</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${cell} text-left`} colSpan={3}>
                    Month : {monthLabel}
                  </th>
                </tr>
                <tr>
                  <th className={cell}>Date</th>
                  <th className={cell}>Time</th>
                  <th className={cell}>Site</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d, i) => (
                  <tr key={d.date} className={d.kind === "holiday" || d.kind === "holiday_work" ? "bg-gray-100 print:bg-gray-100" : ""}>
                    <td className={`${cell} text-center`}>{formatDate(d.date)}</td>
                    <td className={`${cell} relative text-center`}>
                      {d.time ?? ""}
                      {countLabels[i] && (
                        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-semibold">
                          {countLabels[i]}
                        </span>
                      )}
                    </td>
                    <td className={`${cell} relative pr-6 text-center`}>
                      {d.site ?? ""}
                      {d.kind === "holiday_work" && <span className="ml-1 font-bold">(H)</span>}
                      {workDayLabels[i] && (
                        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-semibold">
                          {workDayLabels[i]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="w-full border-collapse">
              <tbody>
                {[
                  ["Work Days (Return Home)", String(workDayCount)],
                  ["Total Day", String(totalDays)],
                  ["Site Allowance / Day", money(dayRate)],
                  ["Total Allowance", money(totalAllowance)],
                  ["Total Holiday", String(totalHolidays)],
                  ["Site Allowance / Holiday", money(holidayRate)],
                  ["Total Allowance Holiday", money(totalHolidayAllowance)],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td className={cell}>{label}</td>
                    <td className={`${cell} w-28 text-right`}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div className="border border-gray-800 p-2 text-center italic">
              Please submit this form to F&amp;A within every of 5th
              <br />
              <span className="not-italic">with signature of your direct superior</span>
            </div>

            <p>I seek the approval on reimburse of other income per details as below :-</p>
            <p className="border border-gray-800 py-1 text-center font-semibold">Total Other Income for Allowance</p>

            <div className="flex items-center justify-between border border-gray-800 px-2 py-2">
              <span>Total Site Allowance</span>
              <span className="border border-gray-800 px-2 py-0.5 font-semibold">{money(totalAllowance)}</span>
            </div>
            <div className="flex items-center justify-between border border-gray-800 px-2 py-2">
              <span>Total Site Allowance Holiday</span>
              <span className="border border-gray-800 px-2 py-0.5 font-semibold">{money(totalHolidayAllowance)}</span>
            </div>
            <p className="text-right text-sm font-bold">Total = {money(grandTotal)}</p>

            <div className="space-y-5 pt-2">
              {["Employee Signature :", "Date :", "Direct Superior :", "Date :"].map((label, i) => (
                <div key={i} className="flex items-end gap-2">
                  <span className="w-28 font-semibold">{label}</span>
                  <span className="flex-1 border-b border-dotted border-gray-800" />
                </div>
              ))}
            </div>

            <div className="space-y-2 pt-2">
              {["Approval", "Not Approval"].map((label) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="inline-block h-5 w-10 border border-gray-800" />
                  <span className="font-semibold">{label}</span>
                </div>
              ))}
            </div>

            <div>
              <p className="font-semibold">Remarks :</p>
              <ul className="mt-1 space-y-1">
                {remarks.map((r, i) => (
                  <li key={i} className="border-b border-dotted border-gray-800 pb-0.5">
                    {r}
                  </li>
                ))}
                <li className="border-b border-dotted border-gray-800 pb-0.5">
                  Allowance {money(dayRate)} × {totalDays} = {money(totalAllowance)}
                </li>
                <li className="border-b border-dotted border-gray-800 pb-0.5">
                  Holiday {money(holidayRate)} × {totalHolidays} = {money(totalHolidayAllowance)}
                </li>
                <li className="border-b border-dotted border-gray-800 pb-0.5 font-semibold">
                  Total = {money(grandTotal)}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AllowanceReportPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading report...</p>}>
      <ReportView />
    </Suspense>
  );
}
