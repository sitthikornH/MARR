"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { FixedTimeRequestReport } from "@/lib/types";

/** "2026-11-03" -> "03/11/2569" (Buddhist year, as on the other forms) */
function thaiDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${Number(y) + 543}`;
}

/** "08:30:00" -> "08:30"; an empty time shows as "-". */
const time = (t: string | null) => (t ? t.slice(0, 5) : "-");

/** Reports come in English or Thai. A status not listed here is shown exactly as TimeMint wrote it. */
function statusView(status: string | null): { label: string; className: string } {
  const s = (status ?? "").trim();
  if (!s) return { label: "-", className: "text-gray-500" };
  if (/reject|ไม่อนุมัติ/i.test(s)) return { label: "ไม่อนุมัติ", className: "text-red-600" };
  if (/pending|รอ/i.test(s)) return { label: "รออนุมัติ", className: "text-amber-700" };
  if (/approve|อนุมัติ/i.test(s)) return { label: "อนุมัติ", className: "text-green-700" };
  return { label: s, className: "text-gray-700" };
}

function ReportView() {
  const params = useSearchParams();
  const employeeId = params.get("employee_id");
  const month = params.get("month");
  const year = params.get("year");

  const [report, setReport] = useState<FixedTimeRequestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/welfare/fixed-time-request?employee_id=${employeeId}&month=${month}&year=${year}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load report");
        setReport(data as FixedTimeRequestReport);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong"));
  }, [employeeId, month, year]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!report) return <p className="text-sm text-gray-500">Loading report...</p>;

  const cell = "border border-gray-800 px-1.5 py-1 align-middle";

  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } body { background: white !important; } }`}</style>

      <div className="print:hidden flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <Link
          href={`/welfare?employee_id=${employeeId}&month=${month}&year=${year}`}
          className="text-sm text-gray-600 underline"
        >
          ← Back
        </Link>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
        >
          Print / Save PDF
        </button>
      </div>

      <div className="mx-auto max-w-[297mm] bg-white p-6 text-[11px] leading-tight text-gray-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <p className="text-center text-xl font-bold tracking-wide">FIXED TIME REQUEST</p>
        <p className="mt-1 text-center">ประวัติการขอเปลี่ยนเวลา</p>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-x-8 gap-y-1">
          <p>
            <span className="font-semibold">พนักงาน</span>
            <span className="ml-3 inline-block min-w-64 border-b border-dotted border-gray-800">
              {report.employee_name} ({report.emp_code})
            </span>
          </p>
          <p>
            <span className="font-semibold">ประจำงวดเดือน :</span>
            <span className="ml-3">
              {report.month}/{report.year + 543}
            </span>
          </p>
          <p>
            <span className="font-semibold">Position</span>
            <span className="ml-3 inline-block min-w-64 border-b border-dotted border-gray-800">{report.position ?? ""}</span>
          </p>
          <p>
            <span className="font-semibold">จำนวนคำขอ :</span>
            <span className="ml-3">{report.rows.length}</span>
          </p>
        </div>

        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr>
              <th className={cell} rowSpan={2}>วันที่</th>
              <th className={cell} rowSpan={2}>ประเภทรายการ</th>
              <th className={cell} colSpan={2}>จากเวลา</th>
              <th className={cell} colSpan={2}>เป็นเวลา</th>
              <th className={cell} rowSpan={2}>เหตุผล</th>
              <th className={cell} rowSpan={2}>สถานะ</th>
              <th className={cell} rowSpan={2}>ผู้อนุมัติ</th>
              <th className={cell} rowSpan={2}>รหัสรายการ</th>
              <th className={cell} rowSpan={2}>วิธีเพิ่ม</th>
              <th className={cell} rowSpan={2}>เพิ่มเมื่อ</th>
              <th className={`${cell} print:hidden`} rowSpan={2}>ภาพ</th>
            </tr>
            <tr>
              <th className={cell}>เข้า</th>
              <th className={cell}>ออก</th>
              <th className={cell}>เข้า</th>
              <th className={cell}>ออก</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => {
              const status = statusView(r.status);
              return (
                <tr key={r.record_no}>
                  <td className={`${cell} text-center whitespace-nowrap`}>{thaiDate(r.date)}</td>
                  <td className={`${cell} text-center`}>{r.record_type ?? ""}</td>
                  <td className={`${cell} text-center`}>{time(r.from_time_in)}</td>
                  <td className={`${cell} text-center`}>{time(r.from_time_out)}</td>
                  <td className={`${cell} text-center font-semibold`}>{time(r.to_time_in)}</td>
                  <td className={`${cell} text-center font-semibold`}>{time(r.to_time_out)}</td>
                  <td className={cell}>{r.reason ?? ""}</td>
                  <td className={`${cell} text-center font-semibold ${status.className}`}>{status.label}</td>
                  <td className={`${cell} text-center`}>{r.approver ?? ""}</td>
                  <td className={`${cell} text-center whitespace-nowrap`}>{r.record_no}</td>
                  <td className={`${cell} text-center`}>{r.added_by ?? ""}</td>
                  <td className={`${cell} text-center`}>{r.created_date ?? ""}</td>
                  <td className={`${cell} text-center print:hidden`}>
                    {r.image_url && (
                      <a href={r.image_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                        เปิด
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
            {report.rows.length === 0 && (
              <tr>
                <td className={`${cell} py-6 text-center text-gray-600`} colSpan={13}>
                  ไม่พบคำขอเปลี่ยนเวลาในเดือนนี้
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <p className="mt-2 text-[10px] text-gray-600">
          ข้อมูลจากหน้าประวัติปรับปรุงเวลาของ TimeMint ณ ครั้งล่าสุดที่ผู้ดูแลระบบดึงจากหน้า Settings
        </p>
      </div>
    </div>
  );
}

export default function FixedTimeRequestPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading report...</p>}>
      <ReportView />
    </Suspense>
  );
}
