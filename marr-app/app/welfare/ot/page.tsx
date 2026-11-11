"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PRINT_COLORS_CSS } from "@/lib/dayHighlight";
import type { OtForm, OtFormRow } from "@/lib/types";

/** "2026-11-03" -> "03/11/2569" (Buddhist year, as on the paper form) */
function thaiDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${Number(y) + 543}`;
}

const duration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** "2026-11-04 14:38:39" -> "04/11/2569 : 14:38" (Buddhist year, as on the paper form). */
function thaiDateTime(value: string): string {
  const [datePart, timePart] = value.split(" ");
  return `${thaiDate(datePart)} : ${(timePart ?? "").slice(0, 5)}`;
}

const STATUS: Record<OtFormRow["status"], { label: string; className: string }> = {
  approved: { label: "อนุมัติ", className: "text-green-700" },
  pending: { label: "รออนุมัติ", className: "text-amber-700" },
  rejected: { label: "ไม่อนุมัติ", className: "text-red-600" },
  no_request: { label: "ไม่มีคำขอ", className: "text-gray-500" },
};

function rowClass(r: OtFormRow): string {
  if (r.holiday?.startsWith("วันหยุดบริษัท")) return "bg-rose-100";
  if (r.holiday) return "bg-gray-100";
  return "";
}

function FormView() {
  const params = useSearchParams();
  const employeeId = params.get("employee_id");
  const month = params.get("month");
  const year = params.get("year");

  const [form, setForm] = useState<OtForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/welfare/ot-report?employee_id=${employeeId}&month=${month}&year=${year}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load form");
        setForm(data as OtForm);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong"));
  }, [employeeId, month, year]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!form) return <p className="text-sm text-gray-500">Loading form...</p>;

  const cell = "border border-gray-800 px-1.5 py-1 align-middle";
  const blankRows = Math.max(0, 12 - form.rows.length); // keep the paper form's look when there are few requests

  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } body { background: white !important; } ${PRINT_COLORS_CSS} }`}</style>

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
        {form.imported_days === 0 && (
          <p className="text-sm text-amber-700">No attendance imported for this month — ask an admin to import it.</p>
        )}
      </div>

      <div className="mx-auto max-w-[297mm] bg-white p-6 text-[11px] leading-tight text-gray-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <p className="text-center text-xl font-bold tracking-wide">OVER TIME</p>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-x-8 gap-y-1">
          <p>
            <span className="font-semibold">ข้าพเจ้า</span>
            <span className="ml-3 inline-block min-w-64 border-b border-dotted border-gray-800">
              {form.employee_name} ({form.emp_code})
            </span>
          </p>
          <p>
            <span className="font-semibold">Position</span>
            <span className="ml-3 inline-block min-w-40 border-b border-dotted border-gray-800">{form.position ?? ""}</span>
          </p>
          <p>ขออนุมัติเบิกเงินค่าล่วงเวลา / ค่าทำงานในวันหยุด</p>
          <p>
            <span className="font-semibold">ประจำงวดเดือน :</span>
            <span className="ml-3">
              {form.month}/{form.year + 543}
            </span>
          </p>
        </div>

        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr>
              <th className={cell} rowSpan={2}>วัน : เวลาแจ้ง</th>
              <th className={cell} rowSpan={2}>วันที่ทำงาน</th>
              <th className={cell} colSpan={2}>เวลาที่ขอ OT</th>
              <th className={cell} colSpan={2}>ลงเวลาจริงในช่วงนั้น</th>
              <th className={cell} rowSpan={2}>
                รวม
                <br />
                (ชั่วโมง)
              </th>
              <th className={cell} rowSpan={2}>สถานะ</th>
              <th className={cell} rowSpan={2}>Project</th>
              <th className={cell} rowSpan={2}>Place</th>
              <th className={cell} rowSpan={2}>Description</th>
            </tr>
            <tr>
              <th className={cell}>เริ่มเวลา</th>
              <th className={cell}>สิ้นสุดเวลา</th>
              <th className={cell}>เริ่มเวลา</th>
              <th className={cell}>สิ้นสุดเวลา</th>
            </tr>
          </thead>
          <tbody>
            {form.rows.map((r, i) => (
              <tr key={r.overtime_id ?? `${r.date}-${i}`} className={rowClass(r)}>
                <td className={`${cell} text-center whitespace-nowrap`}>
                  {r.requested_at ? thaiDateTime(r.requested_at) : "-"}
                </td>
                <td className={`${cell} text-center whitespace-nowrap`}>
                  {thaiDate(r.date)}
                  {r.holiday && <div className="text-[9px] text-gray-600">{r.holiday}</div>}
                </td>
                <td className={`${cell} text-center`}>{r.requested_start ?? "-"}</td>
                <td className={`${cell} text-center`}>{r.requested_end ?? "-"}</td>
                <td className={`${cell} text-center`}>{r.actual_start ?? "-"}</td>
                <td className={`${cell} text-center`}>{r.actual_end ?? "-"}</td>
                <td className={`${cell} text-center`}>
                  {r.status === "approved" ? r.hours : r.status === "pending" ? `(${r.hours})` : "-"}
                  {r.worked_minutes > 0 && <div className="text-[9px] text-gray-500">{duration(r.worked_minutes)}</div>}
                </td>
                <td className={`${cell} text-center font-semibold ${STATUS[r.status].className}`}>{STATUS[r.status].label}</td>
                <td className={cell}></td>
                <td className={cell}>{r.place ?? ""}</td>
                <td className={cell}>{r.description ?? ""}</td>
              </tr>
            ))}
            {Array.from({ length: blankRows }, (_, i) => (
              <tr key={`blank-${i}`}>
                {Array.from({ length: 11 }, (_, j) => (
                  <td key={j} className={`${cell} h-6`}></td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={`${cell} text-center`} colSpan={6}>
                TOTAL
              </td>
              <td className={`${cell} text-center`}>{form.approved_hours}</td>
              <td className={cell} colSpan={4}>
                {form.pending_hours > 0 && (
                  <span className="font-normal text-amber-700">รออนุมัติอีก {form.pending_hours} ชั่วโมง (ยังไม่นับ)</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-2 text-[10px] text-gray-600">
          รวม (ชั่วโมง) = เวลาที่ลงจริงซึ่งทับช่วงที่ขอ OT ปัดทีละรายการ: เศษน้อยกว่า 20 นาทีไม่คิด, ตั้งแต่ 20 นาทีปัดขึ้น
          (ตัวเลขเล็กใต้ช่อง = เวลาที่ทับจริง ชม.:นาที) — นับเฉพาะคำขอที่อนุมัติแล้ว
        </p>

        <div className="mt-12 grid grid-cols-3 gap-8 text-center">
          {["พนักงาน", "Site Manager", "Project Manager"].map((role) => (
            <div key={role}>
              <div className="border-b border-gray-800 pb-6" />
              <p className="mt-1">{role}</p>
              <p className="mt-2">___/___/___</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function OtFormPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading form...</p>}>
      <FormView />
    </Suspense>
  );
}
