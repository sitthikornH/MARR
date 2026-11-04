// Turns TimeMint's "Time Adjustment Request" report sheet into records. Pure; columns are found by
// header name, in either report language (LANG = EN or TH).

export interface TimeAdjustmentRecord {
  record_no: string;
  emp_code: string;
  employee_name: string | null;
  position: string | null;
  employee_group: string | null;
  date: string; // YYYY-MM-DD
  from_time_in: string | null; // HH:MM[:SS]
  from_time_out: string | null;
  to_time_in: string | null;
  to_time_out: string | null;
  reason: string | null;
  place: string | null;
  added_by: string | null;
  created_date: string | null;
  status: string | null;
  image_url: string | null;
}

export const TIME_ADJUSTMENT_UPSERT_SQL = `INSERT INTO time_adjustment_request
  (employee_id, record_no, emp_code, employee_name, position, employee_group, date, from_time_in, from_time_out,
   to_time_in, to_time_out, reason, place, added_by, created_date, status, image_url, source_report_id)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON DUPLICATE KEY UPDATE
   employee_id = VALUES(employee_id), emp_code = VALUES(emp_code), employee_name = VALUES(employee_name),
   position = VALUES(position), employee_group = VALUES(employee_group), date = VALUES(date),
   from_time_in = VALUES(from_time_in), from_time_out = VALUES(from_time_out), to_time_in = VALUES(to_time_in),
   to_time_out = VALUES(to_time_out), reason = VALUES(reason), place = VALUES(place), added_by = VALUES(added_by),
   created_date = VALUES(created_date), status = VALUES(status), image_url = VALUES(image_url),
   source_report_id = VALUES(source_report_id)`;

const REQUIRED_HEADERS = ["employee id", "record no", "date"];

// Headers of a report generated in Thai -> the English header used below.
const THAI_HEADERS: Record<string, string> = {
  รหัส: "employee id",
  ชื่อพนักงาน: "employee name",
  ตำแหน่ง: "position",
  กลุ่มพนักงาน: "employee group",
  รหัสรายการ: "record no",
  วันที่: "date",
  "จากเวลา (เข้า)": "from (check-in time)",
  "จากเวลา (ออก)": "from (check-out time)",
  "เป็นเวลา (เข้า)": "to (check-in time)",
  "เป็นเวลา (ออก)": "to (check-out time)",
  เหตุผล: "reason",
  สถานที่: "place",
  วิธีเพิ่ม: "added by",
  เพิ่มเมื่อ: "created date",
  สถานะ: "status",
  ภาพประกอบ: "image",
};

const headerKey = (cell: string) => {
  const text = cell.trim().toLowerCase();
  return THAI_HEADERS[text] ?? text;
};

const pad = (n: number) => String(n).padStart(2, "0");

const isEmpty = (value: string) => value === "" || value === "-";

/** Excel day number (with optional time fraction) -> [date, time]. */
function fromSerial(serial: number): [string, string] {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const iso = new Date(ms).toISOString();
  return [iso.slice(0, 10), iso.slice(11, 19)];
}

/** "03/10/2569", "03/10/2026", "2026-10-03 ..." or an Excel day number -> "2026-10-03". */
export function parseDate(value: string): string | null {
  const v = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  let year: number, month: number, day: number;
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (slashed) [day, month, year] = [Number(slashed[1]), Number(slashed[2]), Number(slashed[3])];
  else if (/^\d+(\.\d+)?$/.test(v) && Number(v) > 20000) return fromSerial(Number(v))[0];
  else return null;
  if (year > 2400) year -= 543; // Buddhist year
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * "08:30", "8.30:00", "2026-10-03 08:30:00" or an Excel fraction -> "08:30". TimeMint's reports
 * write an empty time as 00:00, so that is stored as NULL.
 */
export function parseTime(value: string): string | null {
  const v = value.trim();
  if (isEmpty(v)) return null;
  let time: string | null = null;
  const clock = /(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*$/.exec(v);
  if (/^\d+(\.\d+)?$/.test(v) && Number(v) < 1) time = fromSerial(25569 + Number(v))[1];
  else if (clock) time = `${pad(Number(clock[1]))}:${clock[2]}${clock[3] ? `:${clock[3]}` : ""}`;
  return !time || /^00:00(:00)?$/.test(time) ? null : time;
}

/** Numeric cell -> "YYYY-MM-DD HH:MM:SS"; text is kept as written. */
function parseCreated(value: string): string | null {
  const v = value.trim();
  if (isEmpty(v)) return null;
  if (/^\d+(\.\d+)?$/.test(v) && Number(v) > 20000) return fromSerial(Number(v)).join(" ");
  return v.slice(0, 30);
}

/** `recognized` is false when the sheet's headers aren't this report's. */
export function parseTimeAdjustmentSheet(rows: string[][]): { recognized: boolean; records: TimeAdjustmentRecord[]; skipped: number } {
  const headerIndex = rows.findIndex((r) => r.some((c) => headerKey(c) === "record no"));
  if (headerIndex < 0) return { recognized: false, records: [], skipped: 0 };

  const columns = new Map(rows[headerIndex].map((h, i) => [headerKey(h), i]));
  if (REQUIRED_HEADERS.some((h) => !columns.has(h))) return { recognized: false, records: [], skipped: 0 };

  const records: TimeAdjustmentRecord[] = [];
  let skipped = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const cell = (...names: string[]) => {
      for (const name of names) {
        const i = columns.get(name);
        if (i !== undefined && row[i] !== undefined) return row[i].trim();
      }
      return "";
    };
    const text = (max: number, ...names: string[]) => {
      const v = cell(...names);
      return isEmpty(v) ? null : v.slice(0, max);
    };
    if (row.every((c) => !c || !c.trim())) continue;

    const recordNo = cell("record no");
    const empCode = cell("employee id");
    const date = parseDate(cell("date"));
    if (!recordNo || !empCode || !date) {
      skipped++;
      continue;
    }
    records.push({
      record_no: recordNo.slice(0, 50),
      emp_code: empCode.slice(0, 255),
      employee_name: text(255, "employee name"),
      position: text(255, "position"),
      employee_group: text(255, "employee group"),
      date,
      from_time_in: parseTime(cell("from (check-in time)")),
      from_time_out: parseTime(cell("from (check-out time)")),
      to_time_in: parseTime(cell("to (check-in time)")),
      to_time_out: parseTime(cell("to (check-out time)")),
      reason: text(1000, "reason"),
      place: text(255, "place"),
      added_by: text(255, "added by"),
      // "Creaded" is how TimeMint spells this header.
      created_date: parseCreated(cell("creaded date", "created date")),
      status: text(50, "status"),
      image_url: text(1000, "image"),
    });
  }
  return { recognized: true, records, skipped };
}
