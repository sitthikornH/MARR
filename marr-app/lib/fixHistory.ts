// Turns the tables read from TimeMint's "ประวัติปรับปรุงเวลา" web page (viewfix.php) into records.
// Pure; columns are found by their Thai header name.

export interface FixHistoryCell {
  text: string;
  link: string | null; // the image or link inside the cell, if any
}

export interface FixHistoryTable {
  section: string | null; // the heading above the table, e.g. "รายการที่อนุมัติแล้ว"
  headers: string[];
  rows: FixHistoryCell[][];
}

export interface FixHistoryRecord {
  record_no: string;
  record_type: string | null;
  added_by: string | null;
  date: string; // YYYY-MM-DD
  from_time_in: string | null;
  from_time_out: string | null;
  to_time_in: string | null;
  to_time_out: string | null;
  reason: string | null;
  created_date: string | null;
  status: string | null;
  system_owner: string | null;
  approver: string | null;
  approval_type: string | null;
  image_url: string | null;
}

export const FIX_HISTORY_UPSERT_SQL = `INSERT INTO time_adjustment_request
  (employee_id, record_no, emp_code, record_type, added_by, date, from_time_in, from_time_out, to_time_in,
   to_time_out, reason, created_date, status, system_owner, approver, approval_type, image_url, source_report_id)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web')
 ON DUPLICATE KEY UPDATE
   employee_id = VALUES(employee_id), emp_code = VALUES(emp_code), record_type = VALUES(record_type),
   added_by = VALUES(added_by), date = VALUES(date), from_time_in = VALUES(from_time_in),
   from_time_out = VALUES(from_time_out), to_time_in = VALUES(to_time_in), to_time_out = VALUES(to_time_out),
   reason = VALUES(reason), created_date = VALUES(created_date), status = VALUES(status),
   system_owner = VALUES(system_owner), approver = VALUES(approver), approval_type = VALUES(approval_type),
   image_url = VALUES(image_url), source_report_id = VALUES(source_report_id)`;

const REQUIRED_HEADERS = ["รายละเอียด", "วันที่", "จาก", "เป็น"];

const THAI_MONTHS = [
  ["มกราคม", "ม.ค."],
  ["กุมภาพันธ์", "ก.พ."],
  ["มีนาคม", "มี.ค."],
  ["เมษายน", "เม.ย."],
  ["พฤษภาคม", "พ.ค."],
  ["มิถุนายน", "มิ.ย."],
  ["กรกฎาคม", "ก.ค."],
  ["สิงหาคม", "ส.ค."],
  ["กันยายน", "ก.ย."],
  ["ตุลาคม", "ต.ค."],
  ["พฤศจิกายน", "พ.ย."],
  ["ธันวาคม", "ธ.ค."],
];

const pad = (n: number) => String(n).padStart(2, "0");

/** "วันที่ 4 พฤศจิกายน 2569", "04/11/2569" or "2026-11-04" -> "2026-11-04". */
export function parseFixDate(value: string): string | null {
  const v = value.replace(/^วันที่/, "").trim();
  let day: number, month: number, year: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  const named = /^(\d{1,2})\s+(\S+)\s+(\d{4})/.exec(v);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (slashed) [day, month, year] = [Number(slashed[1]), Number(slashed[2]), Number(slashed[3])];
  else if (named) {
    day = Number(named[1]);
    month = THAI_MONTHS.findIndex((names) => names.includes(named[2])) + 1;
    year = Number(named[3]);
  } else return null;
  if (year > 2400) year -= 543; // Buddhist year
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const clock = (token: string) => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(token);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
};

/** "06:53 - 13:53" -> [in, out]. "##:##" means no time; text such as "ยกเลิกรายการบันทึก" has none. */
export function parseFixTimes(value: string): [string | null, string | null] {
  const m = /^(\S+)\s*-\s*(\S+)$/.exec(value.trim());
  return m ? [clock(m[1]), clock(m[2])] : [null, null];
}

const MAX_TABLES = 50;
const MAX_ROWS_PER_TABLE = 20_000;

/** Checks the page data the browser sent. Returns null when it isn't table data. */
export function toFixHistoryTables(value: unknown): FixHistoryTable[] | null {
  if (!Array.isArray(value) || value.length > MAX_TABLES) return null;
  const tables: FixHistoryTable[] = [];
  for (const t of value as Partial<FixHistoryTable>[]) {
    if (!t || !Array.isArray(t.headers) || !Array.isArray(t.rows) || t.rows.length > MAX_ROWS_PER_TABLE) return null;
    if (t.headers.some((h) => typeof h !== "string")) return null;
    const valid = t.rows.every(
      (row) =>
        Array.isArray(row) &&
        row.every((c) => c && typeof c.text === "string" && (c.link === null || typeof c.link === "string"))
    );
    if (!valid) return null;
    tables.push({ section: typeof t.section === "string" ? t.section : null, headers: t.headers, rows: t.rows });
  }
  return tables;
}

/** `recognized` is false when no table on the page has this report's columns. */
export function parseFixHistory(tables: FixHistoryTable[]): { recognized: boolean; records: FixHistoryRecord[]; skipped: number } {
  const byNo = new Map<string, FixHistoryRecord>();
  let recognized = false;
  let skipped = 0;

  for (const table of tables) {
    const columns = new Map(table.headers.map((h, i) => [h.trim(), i]));
    if (REQUIRED_HEADERS.some((h) => !columns.has(h))) continue;
    recognized = true;

    for (const row of table.rows) {
      if (row.length < REQUIRED_HEADERS.length) continue; // the "no data" row spans the whole table
      const cell = (name: string) => {
        const i = columns.get(name);
        return i === undefined ? undefined : row[i];
      };
      const text = (name: string, max: number) => {
        const v = cell(name)?.text.trim();
        return v && v !== "-" ? v.slice(0, max) : null;
      };

      const recordNo = /#\w+/.exec(cell("รายละเอียด")?.text ?? "")?.[0] ?? null;
      const date = parseFixDate(cell("วันที่")?.text ?? "");
      if (!recordNo || !date) {
        skipped++;
        continue;
      }
      const [fromIn, fromOut] = parseFixTimes(cell("จาก")?.text ?? "");
      const [toIn, toOut] = parseFixTimes(cell("เป็น")?.text ?? "");
      byNo.set(recordNo, {
        record_no: recordNo.slice(0, 50),
        record_type: text("ประเภทรายการ", 100),
        added_by: text("วิธีเพิ่ม", 255),
        date,
        from_time_in: fromIn,
        from_time_out: fromOut,
        to_time_in: toIn,
        to_time_out: toOut,
        reason: text("เหตุผล", 1000),
        created_date: text("เพิ่มเมื่อ", 30),
        // The approved table may have no status column: its heading says it instead.
        status: text("สถานะ", 50) ?? table.section?.replace(/^รายการ(ที่)?/, "").trim().slice(0, 50) ?? null,
        system_owner: text("เจ้าของระบบ", 255),
        approver: text("ผู้อนุมัติ", 255),
        approval_type: text("ประเภทการอนุมัติ", 100),
        image_url: cell("ภาพ")?.link?.slice(0, 1000) ?? null,
      });
    }
  }
  return { recognized, records: [...byNo.values()], skipped };
}
