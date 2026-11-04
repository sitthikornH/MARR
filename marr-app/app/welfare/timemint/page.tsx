"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import HighlightLegend from "@/app/welfare/HighlightLegend";
import { PRINT_COLORS_CSS } from "@/lib/dayHighlight";
import type { TimeMintMonthReport, TimeMintReportDay } from "@/lib/types";

/** "2026-07-04" -> "04/07/2026" */
function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

const days = (n: number) => (n > 0 ? n.toFixed(2) : "-");

// Same colours as lib/dayHighlight.ts: company holiday rose, leave sky, weekly holiday grey.
function rowClass(d: TimeMintReportDay): string {
  if (d.company_holiday) return "bg-rose-100";
  if (d.leave.personal + d.leave.sick + d.leave.vacation > 0) return "bg-sky-100";
  if (d.weekly_holiday) return "bg-gray-100";
  return "";
}

function ReportView() {
  const params = useSearchParams();
  const employeeId = params.get("employee_id");
  const month = params.get("month");
  const year = params.get("year");

  const [report, setReport] = useState<TimeMintMonthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/welfare/timemint-report?employee_id=${employeeId}&month=${month}&year=${year}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load report");
        setReport(data as TimeMintMonthReport);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong"));
  }, [employeeId, month, year]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!report) return <p className="text-sm text-gray-500">Loading report...</p>;

  const cell = "border border-gray-800 px-1.5 py-0.5 align-middle";
  const missingDays = report.days.length - report.imported_days;
  const mm = String(report.month).padStart(2, "0");

  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: A4; margin: 8mm; } body { background: white !important; } ${PRINT_COLORS_CSS} }`}</style>

      <div className="print:hidden flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <Link href="/welfare" className="text-sm text-gray-600 underline">
          ← Back
        </Link>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
        >
          Print / Save PDF
        </button>
        {missingDays > 0 && (
          <p className="text-sm text-amber-700">
            {report.imported_days === 0 ? "No attendance imported for this month. " : `${missingDays} day(s) not imported. `}
            Ask an admin to import this month from TimeMint.
          </p>
        )}
      </div>

      <div className="mx-auto max-w-[230mm] bg-white p-6 text-[10px] leading-tight text-gray-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${cell} text-left`} rowSpan={2}>รหัสพนักงาน</th>
              <th className={`${cell} text-left`} rowSpan={2}>ชื่อพนักงาน</th>
              <th className={cell} rowSpan={2}>วันที่</th>
              <th className={cell} rowSpan={2}>เวลาทำงาน</th>
              <th className={cell} rowSpan={2}>บันทึกเวลา</th>
              <th className={`${cell} text-left`} rowSpan={2}>สถานที่</th>
              <th className={cell} colSpan={3}>จำนวนวันลา</th>
            </tr>
            <tr>
              <th className={`${cell} w-12`}>ลากิจ</th>
              <th className={`${cell} w-12`}>ลาป่วย</th>
              <th className={`${cell} w-14`}>ลาพักร้อน</th>
            </tr>
          </thead>
          <tbody>
            {report.days.map((d) => (
              <tr key={d.date} className={rowClass(d)}>
                <td className={`${cell} whitespace-nowrap`}>{report.emp_code}</td>
                <td className={`${cell} whitespace-nowrap`}>{report.employee_name}</td>
                <td className={`${cell} text-center whitespace-nowrap`}>{formatDate(d.date)}</td>
                <td className={`${cell} text-center whitespace-nowrap`}>{d.work_time ?? ""}</td>
                <td className={`${cell} text-center whitespace-nowrap`}>{d.record ?? ""}</td>
                <td className={cell}>
                  {d.places.length > 0 ? (
                    d.places.map((p, i) => <div key={i}>{p}</div>)
                  ) : (
                    <div className="text-center">{d.note ?? ""}</div>
                  )}
                </td>
                <td className={`${cell} text-right`}>{days(d.leave.personal)}</td>
                <td className={`${cell} text-right`}>{days(d.leave.sick)}</td>
                <td className={`${cell} text-right`}>{days(d.leave.vacation)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={cell}>{report.emp_code}</td>
              <td className={cell}>{report.employee_name}</td>
              <td className={`${cell} text-center`} colSpan={4}>
                ยอดรวม
              </td>
              <td className={`${cell} text-right`}>{days(report.totals.personal)}</td>
              <td className={`${cell} text-right`}>{days(report.totals.sick)}</td>
              <td className={`${cell} text-right`}>{days(report.totals.vacation)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-2">
          <HighlightLegend />
        </div>

        <p className="mt-6 text-center text-sm">
          วันทำงานตาม TimeMint เดือน {mm}/{report.year} = {report.worked_days} วัน
        </p>

        <p className="mt-10 text-[10px] text-gray-700">ออกรายงานเมื่อ: {report.generated_at}</p>
      </div>
    </div>
  );
}

export default function TimeMintReportPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading report...</p>}>
      <ReportView />
    </Suspense>
  );
}
