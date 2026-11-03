// TimeMint API v3.0 client (https://doc.timemint.co/). No DB access here.
// Every call is a POST of { name, param } to the same base URL, and the JSON body carries its
// own `status` (an HTTP 200 can still be an error).

interface TimeMintResponse<T> {
  status: number;
  message?: T;
  data?: string;
}

export type TokenService = "Employee" | "CheckLog" | "Leave" | "Overtime" | "Shift" | "Holiday";

export async function callTimeMint<T>(body: { name: string; param: object }, token?: string): Promise<T> {
  const baseUrl = process.env.TIMEMINT_API_URL || "https://api.timemint.co/";
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(baseUrl, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
  const payload = (await res.json().catch(() => null)) as TimeMintResponse<T> | null;

  if (!res.ok || !payload || payload.status !== 200 || payload.message === undefined) {
    const detail = payload?.data ?? `HTTP ${res.status}`;
    throw new Error(`TimeMint ${body.name} failed: ${detail}`);
  }
  return payload.message;
}

// TimeMint's token is a JWT of (issued-at second, company, member) with no service in it, and it is
// stored with a unique constraint: two token requests in the same second produce the same token and
// the second fails with "Duplicate entry ... for key 'token'". So token requests are serialized and
// spaced more than a second apart.
const TOKEN_SPACING_MS = 1100;
let tokenQueue: Promise<unknown> = Promise.resolve();
let lastTokenAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Tokens are one-time and expire after 15 minutes, so callers request a fresh one per API call.
export function getToken(service: TokenService): Promise<string> {
  const key = process.env.TIMEMINT_API_KEY;
  if (!key) return Promise.reject(new Error("TIMEMINT_API_KEY is not set in .env.local"));

  const next = tokenQueue.then(async () => {
    const wait = lastTokenAt + TOKEN_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const message = await callTimeMint<{ Token: string }>({
        name: "GenerateTokenServiceOnTimemint",
        param: { Key: key, Service: service },
      });
      return message.Token;
    } finally {
      lastTokenAt = Date.now();
    }
  });
  tokenQueue = next.catch(() => {});
  return next;
}

// ---- Per-employee data for the attendance report ----

export const CHECKLOG_MAX_RANGE_DAYS = 90;
const CHUNK_MAX_RANGE_DAYS = 31; // Leave, Overtime, weekly Holiday and Shift limit

export interface TimeMintEmployeeProfile {
  EmpID: string;
  EmpNameTH: string | null;
  EmpNameEN: string | null;
  EmpPosition: string | null;
  EmpDepartment: string | null;
  EmpApproverID: string | null;
  EmpEmail: string | null;
  EmpTel: string | null;
  EmpWorkTime: string | null; // "HH:MM:SS"
  WorkHoursPerDay: number | null;
  EmpBreakTime: string | null; // break hour, e.g. "12"; empty = no break
}

export interface TimeMintCheckLog {
  CheckLogID: string;
  CheckLogIn: string | null; // "YYYY-MM-DD HH:MM:SS"
  CheckLogOut: string | null;
  CheckLogPlaceName: string | null;
  CheckLogAdjustment: boolean;
}

export interface TimeMintLeave {
  LeaveID: string;
  LeaveUnit: string; // "Days" or hour-based
  LeaveStart: string;
  LeaveEnd: string;
  LeaveTotalHours: number;
  LeaveType: string;
  LeaveTypeEN: string | null;
  LeaveStatus: string;
}

export interface TimeMintOvertime {
  OvertimeID: string;
  OvertimeDate: string;
  OvertimeTimeStart: string;
  OvertimeTimeEnd: string;
  OvertimeMinutes: number;
  OvertimeType: string; // e.g. "AfterWorktime"
  OvertimeDayType: string; // e.g. "Worktime"
  OvertimeReason: string | null;
  OvertimeRecordStatus: string;
}

export interface TimeMintShift {
  ShiftDate: string;
  ShiftDisplayStartWorkTime: string | null; // "HH:MM"
  ShiftDisplayEndWorkTime: string | null;
}

export interface TimeMintDatedHoliday {
  Date: string;
  DateINFO?: string; // annual holidays only
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** Calls a per-employee, date-ranged endpoint in windows of `maxDays` and concatenates `listKey` from each response. */
async function fetchRanged<T>(
  service: TokenService,
  name: string,
  listKey: string,
  empId: string,
  dateStart: string,
  dateEnd: string,
  maxDays: number,
  extraParam: object = {}
): Promise<T[]> {
  const items: T[] = [];
  for (let chunkStart = dateStart; chunkStart <= dateEnd; chunkStart = addDays(chunkStart, maxDays)) {
    const chunkEnd = [addDays(chunkStart, maxDays - 1), dateEnd].sort()[0];
    const token = await getToken(service);
    const message = await callTimeMint<Record<string, unknown>[]>(
      { name, param: { Service: "GetByID", EmpID: empId, DateStart: chunkStart, DateEnd: chunkEnd, ...extraParam } },
      token
    );
    for (const emp of message) items.push(...((emp[listKey] as T[] | undefined) ?? []));
  }
  return items;
}

const dedupeBy = <T>(items: T[], key: (t: T) => string): T[] => [...new Map(items.map((i) => [key(i), i])).values()];

export async function fetchEmployeeProfile(empId: string): Promise<TimeMintEmployeeProfile | null> {
  const token = await getToken("Employee");
  const message = await callTimeMint<TimeMintEmployeeProfile[]>(
    { name: "GetEmpData", param: { Service: "GetByID", EmpID: empId } },
    token
  );
  return message[0] ?? null;
}

export async function fetchCheckLogs(empId: string, dateStart: string, dateEnd: string): Promise<TimeMintCheckLog[]> {
  return fetchRanged<TimeMintCheckLog>("CheckLog", "GetCheckLogData", "CheckLogData", empId, dateStart, dateEnd, CHECKLOG_MAX_RANGE_DAYS);
}

/** Approved, active leave records. A leave spanning two windows is returned twice, so dedupe by LeaveID. */
export async function fetchApprovedLeaves(empId: string, dateStart: string, dateEnd: string): Promise<TimeMintLeave[]> {
  const leaves = await fetchRanged<TimeMintLeave>("Leave", "GetLeaveData", "LeaveData", empId, dateStart, dateEnd, CHUNK_MAX_RANGE_DAYS, {
    RecordStatus: "APPROVE",
    ActiveStatus: "ACTIVE",
  });
  return dedupeBy(leaves, (l) => l.LeaveID);
}

/** Approved and pending overtime requests (the report's "Overtime request history"). */
export async function fetchOvertimes(empId: string, dateStart: string, dateEnd: string): Promise<TimeMintOvertime[]> {
  const overtimes = await fetchRanged<TimeMintOvertime>("Overtime", "GetOvertimeData", "OverTimeData", empId, dateStart, dateEnd, CHUNK_MAX_RANGE_DAYS, {
    RecordStatus: "ALL",
  });
  return dedupeBy(overtimes, (o) => o.OvertimeID);
}

export async function fetchShifts(empId: string, dateStart: string, dateEnd: string): Promise<TimeMintShift[]> {
  return fetchRanged<TimeMintShift>("Shift", "GetShiftData", "ShiftData", empId, dateStart, dateEnd, CHUNK_MAX_RANGE_DAYS);
}

export async function fetchWeeklyHolidays(empId: string, dateStart: string, dateEnd: string): Promise<TimeMintDatedHoliday[]> {
  return fetchRanged<TimeMintDatedHoliday>("Holiday", "GetHolidayData", "EmpHoliday", empId, dateStart, dateEnd, CHUNK_MAX_RANGE_DAYS);
}

/** Annual (company) holidays for every calendar year the range touches. */
export async function fetchAnnualHolidays(empId: string, dateStart: string, dateEnd: string): Promise<TimeMintDatedHoliday[]> {
  const holidays: TimeMintDatedHoliday[] = [];
  for (let year = Number(dateStart.slice(0, 4)); year <= Number(dateEnd.slice(0, 4)); year++) {
    const token = await getToken("Holiday");
    const message = await callTimeMint<Record<string, unknown> | Record<string, unknown>[]>(
      { name: "GetAnnualHolidayData", param: { Service: "GetByID", EmpID: empId, Year: String(year) } },
      token
    );
    // The docs show `message` as a single object holding `HolidayData`; accept an array too.
    for (const entry of Array.isArray(message) ? message : [message]) {
      holidays.push(...(((entry.HolidayData ?? entry.Holiday) as TimeMintDatedHoliday[] | undefined) ?? []));
    }
  }
  return holidays.filter((h) => h.Date >= dateStart && h.Date <= dateEnd);
}

