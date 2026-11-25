// Shared classification of time_adjustment_request.status, which TimeMint writes as free text in
// English or Thai (e.g. "อนุมัติแล้ว (2026-11-03 08:41:24)"). Pure, no DB access. A status not
// matched here is "other" and shown exactly as TimeMint wrote it by the pages that display it.
export type TimeAdjustmentStatusKind = "approved" | "pending" | "rejected" | "other";

export function timeAdjustmentStatusKind(status: string | null): TimeAdjustmentStatusKind {
  const s = (status ?? "").trim();
  if (!s) return "other";
  if (/reject|ไม่อนุมัติ/i.test(s)) return "rejected";
  if (/pending|รอ/i.test(s)) return "pending";
  if (/approve|อนุมัติ/i.test(s)) return "approved";
  return "other";
}

/** Pulls "2026-11-03 08:41:24" out of a status like "อนุมัติแล้ว (2026-11-03 08:41:24)". Null when
 *  there's no parenthesized timestamp (e.g. still pending). */
export function timeAdjustmentStatusTimestamp(status: string | null): string | null {
  const m = /\((\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\)/.exec(status ?? "");
  return m ? m[1] : null;
}
