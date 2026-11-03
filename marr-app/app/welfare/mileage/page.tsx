"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AllowanceReportDay, MileageEntry, MileageForm, MileageOtherItem } from "@/lib/types";

const DEFAULT_FROM = "ที่พัก";
const INPUT_KINDS: AllowanceReportDay["kind"][] = ["work", "uncounted", "holiday_work"];

interface Draft {
  time: string;
  from_place: string;
  to_place: string;
  km: string;
  site: string;
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-07-04" -> "04/07/2026" */
function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function toDraft(entry: MileageEntry): Draft {
  return {
    time: entry.time ?? "",
    from_place: entry.from_place ?? "",
    to_place: entry.to_place ?? "",
    km: String(entry.km),
    site: entry.site ?? "",
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.time === b.time && a.from_place === b.from_place && a.to_place === b.to_place && Number(a.km) === Number(b.km) && a.site === b.site;
}

function FormView() {
  const params = useSearchParams();
  const employeeId = params.get("employee_id");
  const month = params.get("month");
  const year = params.get("year");

  const [form, setForm] = useState<MileageForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Record<string, MileageEntry>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rowState, setRowState] = useState<Record<string, { saving?: boolean; error?: string }>>({});

  const [rate, setRate] = useState("5");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState<MileageOtherItem[]>([]);
  const [claimSaving, setClaimSaving] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/welfare/mileage?employee_id=${employeeId}&month=${month}&year=${year}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load form");
        const f = data as MileageForm;
        setForm(f);
        setRate(String(f.rate_per_km));
        setRemarks(f.remarks ?? "");
        setItems(f.other_items);

        const byDate: Record<string, MileageEntry> = {};
        for (const e of f.entries) byDate[e.date] = e;
        setSubmitted(byDate);

        // Unsubmitted rows start from the day's shift time and check-in places, and repeat the most
        // recently submitted From / Site.
        const latest = [...f.entries].sort((a, b) => b.date.localeCompare(a.date))[0];
        const initial: Record<string, Draft> = {};
        for (const day of f.days) {
          if (byDate[day.date]) initial[day.date] = toDraft(byDate[day.date]);
          else if (INPUT_KINDS.includes(day.kind)) {
            initial[day.date] = {
              time: day.time ?? "",
              from_place: latest?.from_place ?? DEFAULT_FROM,
              to_place: day.site ?? "",
              km: "",
              site: latest?.site ?? "",
            };
          }
        }
        setDrafts(initial);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    }
    load();
  }, [employeeId, month, year]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!form) return <p className="text-sm text-gray-500">Loading form...</p>;

  function setDraft(date: string, field: keyof Draft, value: string) {
    setDrafts({ ...drafts, [date]: { ...drafts[date], [field]: value } });
    setRowState({ ...rowState, [date]: {} });
  }

  async function submitRow(date: string) {
    const draft = drafts[date];
    const km = Number(draft.km);
    if (draft.km.trim() === "" || !Number.isFinite(km) || km < 0) {
      setRowState({ ...rowState, [date]: { error: "Enter KM (0 or more)" } });
      return;
    }
    setRowState({ ...rowState, [date]: { saving: true } });
    try {
      const res = await fetch("/api/welfare/mileage/entry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: Number(employeeId), date, ...draft, km }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      const entry = data as MileageEntry;
      setSubmitted((s) => ({ ...s, [date]: entry }));
      setDrafts((d) => ({ ...d, [date]: toDraft(entry) }));
      setRowState((r) => ({ ...r, [date]: {} }));
    } catch (err) {
      setRowState((r) => ({ ...r, [date]: { error: err instanceof Error ? err.message : "Failed" } }));
    }
  }

  async function saveClaim() {
    const rateNum = Number(rate);
    if (!Number.isFinite(rateNum) || rateNum < 0) {
      setClaimMessage("Rate per KM must be 0 or more.");
      return;
    }
    if (items.some((i) => !i.description.trim() || !Number.isFinite(i.amount))) {
      setClaimMessage("Every line needs a description and an amount.");
      return;
    }
    setClaimSaving(true);
    setClaimMessage(null);
    try {
      const res = await fetch("/api/welfare/mileage/claim", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: Number(employeeId),
          month: form!.month,
          year: form!.year,
          rate_per_km: rateNum,
          remarks,
          other_items: items,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setClaimMessage("Saved.");
    } catch (err) {
      setClaimMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setClaimSaving(false);
    }
  }

  const monthLabel = new Date(form.year, form.month - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const rateNum = Number(rate) || 0;
  const totalKm = Object.values(submitted).reduce((sum, e) => sum + e.km, 0);
  const totalMileage = totalKm * rateNum;
  const totalOther = totalMileage + items.reduce((sum, i) => sum + (Number.isFinite(i.amount) ? i.amount : 0), 0);
  const inputDates = Object.keys(drafts);
  const pendingCount = inputDates.filter((d) => !submitted[d] || !sameDraft(drafts[d], toDraft(submitted[d]))).length;

  const autoRemarks = [
    ...form.days.filter((d) => d.kind === "leave").map((d) => `${longDate(d.date)} : ${d.site}`),
    ...form.days.filter((d) => d.kind === "holiday_work").map((d) => `${longDate(d.date)} : Worked on holiday${d.note ? ` (${d.note})` : ""}`),
  ];

  const cell = "border border-gray-800 px-1.5 py-0.5";
  const input = "w-full bg-transparent px-1 py-0.5 text-center text-[11px] outline-none focus:bg-yellow-50 print:hidden";
  const missingDays = form.days.length - form.imported_days;

  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: A4; margin: 8mm; } body { background: white !important; } }`}</style>

      <div className="print:hidden flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <Link href="/welfare" className="text-sm text-gray-600 underline">
          ← Back
        </Link>
        <p className="text-sm text-gray-700">
          {inputDates.length - pendingCount} of {inputDates.length} rows submitted
          {pendingCount > 0 && <span className="ml-1 text-amber-700">({pendingCount} waiting for input)</span>}
        </p>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
        >
          Print / Save PDF
        </button>
        {missingDays > 0 && (
          <p className="text-sm text-amber-700">
            {form.imported_days === 0 ? "No attendance imported for this month. " : `${missingDays} day(s) not imported. `}
            <Link href="/attendance/import" className="underline">
              Import from TimeMint
            </Link>
          </p>
        )}
      </div>

      <div className="mx-auto max-w-[230mm] bg-white p-6 text-[11px] leading-tight text-gray-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <p className="text-2xl font-black tracking-tight">ENSYS</p>
        <p className="mt-1 border border-gray-800 py-1 text-center text-sm font-bold">
          OTHER INCOME FOR MILEAGE AND TELEPHONE CHARGE
        </p>

        <div className="mt-2 grid grid-cols-[1.45fr_1fr] gap-4">
          {/* Left column */}
          <div className="space-y-3">
            <table className="w-full border-collapse">
              <tbody>
                {[
                  ["Employee Name", `${form.employee_name} (${form.emp_code})`],
                  ["Position", form.position],
                  ["Department", form.department],
                  ["Direct Superior", form.direct_superior],
                  ["Site", form.site],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td className={`${cell} w-28 font-semibold`}>{label}</td>
                    <td className={cell}>{value ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="border border-gray-800 py-0.5 text-center font-semibold">Mileage - 301</p>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Rate :</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-20 rounded border border-gray-300 px-1 py-0.5 text-right print:hidden"
              />
              <span className="hidden print:inline">{money(rateNum)}</span>
              <span>/ KM</span>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${cell} text-left`} colSpan={7}>
                    Month : {monthLabel}
                  </th>
                </tr>
                <tr>
                  <th className={cell}>Date</th>
                  <th className={cell}>Time</th>
                  <th className={cell}>From</th>
                  <th className={cell}>To</th>
                  <th className={cell}>TOTAL KM.</th>
                  <th className={cell}>Site</th>
                  <th className={`${cell} print:hidden`}></th>
                </tr>
              </thead>
              <tbody>
                {form.days.map((day) => {
                  const draft = drafts[day.date];
                  const saved = submitted[day.date];
                  const state = rowState[day.date] ?? {};
                  const dirty = draft && (!saved || !sameDraft(draft, toDraft(saved)));
                  const shade = day.kind === "holiday" || day.kind === "holiday_work" ? "bg-gray-100" : "";

                  if (!draft) {
                    return (
                      <tr key={day.date} className={shade}>
                        <td className={`${cell} text-center`}>{formatDate(day.date)}</td>
                        <td className={`${cell} text-center`}>{day.kind === "leave" ? day.time ?? "" : ""}</td>
                        <td className={cell} colSpan={2}>
                          <span className="block text-center">{day.kind === "leave" ? day.site : ""}</span>
                        </td>
                        <td className={`${cell} text-center`}>{day.kind === "holiday" ? "X" : ""}</td>
                        <td className={cell}></td>
                        <td className={`${cell} print:hidden`}></td>
                      </tr>
                    );
                  }

                  const field = (name: keyof Draft, placeholder = "", type = "text") => (
                    <>
                      <input
                        type={type}
                        step={type === "number" ? "0.1" : undefined}
                        min={type === "number" ? "0" : undefined}
                        value={draft[name]}
                        placeholder={placeholder}
                        onChange={(e) => setDraft(day.date, name, e.target.value)}
                        className={input}
                      />
                      <span className="hidden print:block text-center">
                        {saved ? (name === "km" ? saved.km : saved[name] ?? "") : name === "to_place" ? draft.to_place : ""}
                      </span>
                    </>
                  );

                  return (
                    <tr key={day.date} className={`${shade} ${dirty ? "bg-amber-50 print:bg-transparent" : ""}`}>
                      <td className={`${cell} text-center`}>{formatDate(day.date)}</td>
                      <td className={`${cell} w-20`}>{field("time")}</td>
                      <td className={`${cell} w-20`}>{field("from_place")}</td>
                      <td className={cell}>{field("to_place")}</td>
                      <td className={`${cell} w-16`}>{field("km", "km", "number")}</td>
                      <td className={`${cell} w-20`}>{field("site", "site")}</td>
                      <td className={`${cell} w-20 text-center print:hidden`}>
                        {state.saving ? (
                          <span className="text-gray-500">Saving...</span>
                        ) : dirty ? (
                          <button
                            onClick={() => submitRow(day.date)}
                            className="rounded bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-gray-700"
                          >
                            {saved ? "Update" : "Submit"}
                          </button>
                        ) : (
                          <span className="text-green-700">✓</span>
                        )}
                        {state.error && <p className="text-[10px] text-red-600">{state.error}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <table className="w-full border-collapse">
              <tbody>
                {[
                  ["Total KM", money(totalKm)],
                  [`${money(rateNum)} / KM`, money(rateNum)],
                  ["Total Mileage", money(totalMileage)],
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
            <div className="border border-gray-800 p-2 text-center">
              <p className="italic">Please submit this form to F&amp;A within every of 22th</p>
              <p>with signature of your direct superior</p>
              <p className="mt-1 text-[10px]">
                Please also be notified that if you submit later than of date of 22th, your reimburse will be
                automaticly transfer to the next month
              </p>
            </div>

            <p className="border border-gray-800 py-1 text-center font-semibold">Telephone &amp; Internet Charge - 310</p>
            <p className="border border-gray-800 py-1 text-center font-semibold">Total Cost</p>

            <p>I seek the approval on reimburse of other income per details as below :-</p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={cell}>Total Other Income</th>
                  <th className={cell}>Period</th>
                  <th className={cell}>Amount</th>
                  <th className={`${cell} print:hidden`}></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={cell}>Mileage</td>
                  <td className={`${cell} text-center`}>{monthLabel}</td>
                  <td className={`${cell} text-right`}>{money(totalMileage)}</td>
                  <td className={`${cell} print:hidden`}></td>
                </tr>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td className={cell}>
                      <input
                        value={item.description}
                        onChange={(e) => setItems(items.map((it, j) => (j === i ? { ...it, description: e.target.value } : it)))}
                        className="w-full bg-transparent outline-none focus:bg-yellow-50 print:hidden"
                      />
                      <span className="hidden print:inline">{item.description}</span>
                    </td>
                    <td className={cell}>
                      <input
                        value={item.period ?? ""}
                        onChange={(e) => setItems(items.map((it, j) => (j === i ? { ...it, period: e.target.value } : it)))}
                        className="w-full bg-transparent text-center outline-none focus:bg-yellow-50 print:hidden"
                      />
                      <span className="hidden print:block text-center">{item.period}</span>
                    </td>
                    <td className={cell}>
                      <input
                        type="number"
                        step="0.01"
                        value={Number.isFinite(item.amount) ? item.amount : ""}
                        onChange={(e) => setItems(items.map((it, j) => (j === i ? { ...it, amount: Number(e.target.value) } : it)))}
                        className="w-full bg-transparent text-right outline-none focus:bg-yellow-50 print:hidden"
                      />
                      <span className="hidden print:block text-right">{money(item.amount)}</span>
                    </td>
                    <td className={`${cell} text-center print:hidden`}>
                      <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-red-600">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="print:hidden">
                  <td className={cell} colSpan={4}>
                    <button
                      onClick={() =>
                        setItems([
                          ...items,
                          {
                            description: items.length === 0 ? "Telephone & Internet" : "",
                            period: monthLabel,
                            amount: 0,
                          },
                        ])
                      }
                      className="text-gray-700 underline"
                    >
                      + Add line
                    </button>
                  </td>
                </tr>
                <tr>
                  <td className={`${cell} font-semibold`} colSpan={2}>
                    Total Other Income
                  </td>
                  <td className={`${cell} text-right font-semibold`}>{money(totalOther)}</td>
                  <td className={`${cell} print:hidden`}></td>
                </tr>
              </tbody>
            </table>

            <div className="flex items-center gap-3 print:hidden">
              <button
                onClick={saveClaim}
                disabled={claimSaving}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {claimSaving ? "Saving..." : "Save rate, other income & remarks"}
              </button>
              {claimMessage && <span className="text-xs text-gray-600">{claimMessage}</span>}
            </div>

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
                {autoRemarks.map((r, i) => (
                  <li key={i} className="border-b border-dotted border-gray-800 pb-0.5">
                    {r}
                  </li>
                ))}
                <li className="border-b border-dotted border-gray-800 pb-0.5">
                  KM {money(totalKm)} × {money(rateNum)} = {money(totalMileage)}
                </li>
                {items.map((item, i) => (
                  <li key={i} className="border-b border-dotted border-gray-800 pb-0.5">
                    {item.description} {item.period ? `(${item.period})` : ""} = {money(item.amount)}
                  </li>
                ))}
              </ul>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Additional remarks"
                rows={3}
                className="mt-2 w-full rounded border border-gray-300 p-1 print:hidden"
              />
              {remarks && <p className="mt-1 hidden whitespace-pre-line print:block">{remarks}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MileagePage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-500">Loading form...</p>}>
      <FormView />
    </Suspense>
  );
}
