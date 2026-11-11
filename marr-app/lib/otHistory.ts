// Turns the tables read from TimeMint's "รายการทำงานล่วงเวลา" web page (viewot.php) into records.
// Pure; columns are found by their Thai header name. Only "เพิ่มเมื่อ" (when the request was submitted)
// is kept — the TimeMint API never returns it, but the website shows it next to the OT request.

export interface OtHistoryCell {
  text: string;
  link: string | null;
}

export interface OtHistoryTable {
  section: string | null;
  headers: string[];
  rows: OtHistoryCell[][];
}

export interface OtHistoryRecord {
  overtime_id: string; // "#OT3173704", matches overtime_request.overtime_id
  requested_at: string; // "YYYY-MM-DD HH:MM:SS"
}

const REQUIRED_HEADERS = ["รายละเอียด", "รวม", "สถานะ"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-04 14:38:39" -> "2026-11-04 14:38:39". Null when it isn't a date and time. */
export function parseAddedAt(value: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${pad(Number(mo))}-${pad(Number(d))} ${pad(Number(h))}:${mi}:${s ?? "00"}`;
}

const MAX_TABLES = 50;
const MAX_ROWS_PER_TABLE = 20_000;

/** Checks the page data the browser sent. Returns null when it isn't table data. */
export function toOtHistoryTables(value: unknown): OtHistoryTable[] | null {
  if (!Array.isArray(value) || value.length > MAX_TABLES) return null;
  const tables: OtHistoryTable[] = [];
  for (const t of value as Partial<OtHistoryTable>[]) {
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
export function parseOtHistory(tables: OtHistoryTable[]): { recognized: boolean; records: OtHistoryRecord[]; skipped: number } {
  const byId = new Map<string, OtHistoryRecord>();
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

      const overtimeId = /#\w+/.exec(cell("รายละเอียด")?.text ?? "")?.[0] ?? null;
      const requestedAt = parseAddedAt(cell("เพิ่มเมื่อ")?.text ?? "");
      if (!overtimeId || !requestedAt) {
        skipped++;
        continue;
      }
      byId.set(overtimeId, { overtime_id: overtimeId.slice(0, 50), requested_at: requestedAt });
    }
  }
  return { recognized, records: [...byId.values()], skipped };
}
