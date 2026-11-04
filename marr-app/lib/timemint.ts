// TimeMint API v3.0 client (https://doc.timemint.co/). No DB access here.
// Every call is a POST of { name, param } to the same base URL, and the JSON body carries its
// own `status` (an HTTP 200 can still be an error).

interface TimeMintResponse<T> {
  status: number;
  message?: T;
  data?: string;
}

export type TokenService = "Employee" | "CheckLog" | "Leave" | "Overtime" | "Shift" | "Holiday" | "Report";

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

/** One employee (GetByID) or the whole company in one call per window (GetByCom). */
export type Scope = { empId: string } | "company";

const scopeParam = (scope: Scope) => (scope === "company" ? { Service: "GetByCom" } : { Service: "GetByID", EmpID: scope.empId });

/** Results keyed by EmpID. */
export type ByEmployee<T> = Map<string, T[]>;

function addTo<T>(map: ByEmployee<T>, empId: string, items: T[]) {
  map.set(empId, [...(map.get(empId) ?? []), ...items]);
}

/**
 * Calls a date-ranged endpoint in windows of `maxDays` and groups `listKey` of each employee in
 * the response by EmpID.
 */
async function fetchRanged<T>(
  service: TokenService,
  name: string,
  listKey: string,
  scope: Scope,
  dateStart: string,
  dateEnd: string,
  maxDays: number,
  extraParam: object = {}
): Promise<ByEmployee<T>> {
  const byEmp: ByEmployee<T> = new Map();
  for (let chunkStart = dateStart; chunkStart <= dateEnd; chunkStart = addDays(chunkStart, maxDays)) {
    const chunkEnd = [addDays(chunkStart, maxDays - 1), dateEnd].sort()[0];
    const token = await getToken(service);
    const message = await callTimeMint<Record<string, unknown>[]>(
      { name, param: { ...scopeParam(scope), DateStart: chunkStart, DateEnd: chunkEnd, ...extraParam } },
      token
    );
    for (const emp of message) addTo(byEmp, String(emp.EmpID), (emp[listKey] as T[] | undefined) ?? []);
  }
  return byEmp;
}

function dedupeEach<T>(byEmp: ByEmployee<T>, key: (t: T) => string): ByEmployee<T> {
  return new Map([...byEmp].map(([emp, items]) => [emp, [...new Map(items.map((i) => [key(i), i])).values()]]));
}

/** For one employee: their list from a per-employee result. */
export const forEmployee = <T>(byEmp: ByEmployee<T>, empId: string): T[] => byEmp.get(empId) ?? [];

export async function fetchProfiles(scope: Scope): Promise<Map<string, TimeMintEmployeeProfile>> {
  const token = await getToken("Employee");
  const message = await callTimeMint<TimeMintEmployeeProfile[]>({ name: "GetEmpData", param: scopeParam(scope) }, token);
  return new Map(message.map((p) => [p.EmpID, p]));
}

export async function fetchEmployeeProfile(empId: string): Promise<TimeMintEmployeeProfile | null> {
  return (await fetchProfiles({ empId })).get(empId) ?? null;
}

export function fetchCheckLogs(scope: Scope, dateStart: string, dateEnd: string): Promise<ByEmployee<TimeMintCheckLog>> {
  return fetchRanged("CheckLog", "GetCheckLogData", "CheckLogData", scope, dateStart, dateEnd, CHECKLOG_MAX_RANGE_DAYS);
}

/** Approved, active leave records. A leave spanning two windows is returned twice, so dedupe by LeaveID. */
export async function fetchApprovedLeaves(scope: Scope, dateStart: string, dateEnd: string): Promise<ByEmployee<TimeMintLeave>> {
  const leaves = await fetchRanged<TimeMintLeave>("Leave", "GetLeaveData", "LeaveData", scope, dateStart, dateEnd, CHUNK_MAX_RANGE_DAYS, {
    RecordStatus: "APPROVE",
    ActiveStatus: "ACTIVE",
  });
  return dedupeEach(leaves, (l) => l.LeaveID);
}

/** Approved and pending overtime requests (the report's "Overtime request history"). */
export async function fetchOvertimes(scope: Scope, dateStart: string, dateEnd: string): Promise<ByEmployee<TimeMintOvertime>> {
  const overtimes = await fetchRanged<TimeMintOvertime>("Overtime", "GetOvertimeData", "OverTimeData", scope, dateStart, dateEnd, CHUNK_MAX_RANGE_DAYS, {
    RecordStatus: "ALL",
  });
  return dedupeEach(overtimes, (o) => o.OvertimeID);
}

export function fetchShifts(scope: Scope, dateStart: string, dateEnd: string): Promise<ByEmployee<TimeMintShift>> {
  return fetchRanged("Shift", "GetShiftData", "ShiftData", scope, dateStart, dateEnd, CHUNK_MAX_RANGE_DAYS);
}

export function fetchWeeklyHolidays(scope: Scope, dateStart: string, dateEnd: string): Promise<ByEmployee<TimeMintDatedHoliday>> {
  return fetchRanged("Holiday", "GetHolidayData", "EmpHoliday", scope, dateStart, dateEnd, CHUNK_MAX_RANGE_DAYS);
}

export interface TimeMintReportFile {
  ID: string;
  DATESTART: string;
  DATEEND: string;
  PATH: string | null;
  STATUS_CODE: string | number;
  ADD: string;
}

const REPORT_FILE_HOST = "report.timemint.co";
const REPORT_FILE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * "Time Adjustment Request" report files already generated in TimeMint. TimeMint has no API that
 * returns these records and the Report API can't create a report, so someone has to generate it in
 * TimeMint (or set up an AutoReport).
 */
export async function fetchTimeAdjustmentReports(): Promise<TimeMintReportFile[]> {
  const token = await getToken("Report");
  return callTimeMint<TimeMintReportFile[]>(
    { name: "GetReportData", param: { Service: "GetReportData", Filter: { TYPE: "Time Adjustment Request" } } },
    token
  );
}

export async function downloadReportFile(fileUrl: string): Promise<Buffer> {
  const url = new URL(fileUrl);
  if (url.protocol !== "https:" || url.hostname !== REPORT_FILE_HOST) {
    throw new Error(`Unexpected report file location: ${url.hostname}`);
  }
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Report file download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > REPORT_FILE_MAX_BYTES) throw new Error("Report file is too large");
  return buf;
}

/** Annual (company) holidays for every calendar year the range touches. */
export async function fetchAnnualHolidays(scope: Scope, dateStart: string, dateEnd: string): Promise<ByEmployee<TimeMintDatedHoliday>> {
  const byEmp: ByEmployee<TimeMintDatedHoliday> = new Map();
  for (let year = Number(dateStart.slice(0, 4)); year <= Number(dateEnd.slice(0, 4)); year++) {
    const token = await getToken("Holiday");
    const message = await callTimeMint<Record<string, unknown> | Record<string, unknown>[]>(
      { name: "GetAnnualHolidayData", param: { ...scopeParam(scope), Year: String(year) } },
      token
    );
    // For one employee the docs show `message` as a single object; the company call returns an array.
    for (const entry of Array.isArray(message) ? message : [message]) {
      const holidays = ((entry.HolidayData ?? entry.Holiday) as TimeMintDatedHoliday[] | undefined) ?? [];
      addTo(byEmp, String(entry.EmpID), holidays.filter((h) => h.Date >= dateStart && h.Date <= dateEnd));
    }
  }
  return byEmp;
}

