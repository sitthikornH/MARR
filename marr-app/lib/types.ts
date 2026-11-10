export interface Employee {
  id: number;
  emp_code: string;
  name: string;
  base_allowance: number;
  base_ot_rate: number;
  return_home_rate: number;
  created_at: string;
  // Login account, only in the admin listing (GET /api/employees); null = no account yet
  account?: EmployeeAccount | null;
}

export interface EmployeeAccount {
  username: string;
  role: UserRole;
  has_password: boolean;
  locked: boolean;
}

export type NewEmployee = Pick<
  Employee,
  "emp_code" | "name" | "base_allowance" | "base_ot_rate" | "return_home_rate"
>;

export type EmployeeRatesUpdate = Pick<Employee, "base_allowance" | "base_ot_rate" | "return_home_rate">;

export interface LocationRate {
  id: number;
  location_name: string;
  travel_fee: number;
}

export type LeaveType = string;

export interface Attendance {
  id: number;
  employee_id: number;
  date: string;
  time_in: string | null;
  time_out: string | null;
  location_name: string | null;
  leave_type: LeaveType | null;
  created_at: string;
}

export type NewAttendance = Pick<
  Attendance,
  "employee_id" | "date" | "time_in" | "time_out" | "location_name" | "leave_type"
>;

export interface WelfareSummary {
  id: number;
  employee_id: number;
  month: number;
  year: number;
  total_allowance: number;
  total_travel: number;
  total_ot: number;
  total_return_home: number;
  created_at: string;
}

export interface WelfareCalculateRequest {
  employee_id: number;
  month: number;
  year: number;
}

export interface WelfareCalculateResult {
  employee_id: number;
  month: number;
  year: number;
  total_allowance: number;
  total_travel: number;
  total_ot: number;
  total_return_home: number;
  ot_hours: number; // rounded OT hours behind total_ot
  work_days: number; // days counted for the return-home bonus
  base_days: number; // days in month - Sundays - TimeMint company holidays
  half_threshold_days: number; // floor(50% of base_days): half bonus from here
  full_threshold_days: number; // floor(80% of base_days): full bonus from here
}

export type SyncStatus = "success" | "error";

export interface AppSettings {
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  last_sync_status: SyncStatus | null;
  last_sync_message: string | null;
  // automatic company-wide attendance import (lib/companyImport.ts)
  auto_import_enabled: boolean;
  import_interval_minutes: number;
  last_import_at: string | null;
  last_import_status: SyncStatus | null;
  last_import_message: string | null;
}

/** Either group may be sent on its own. */
export type AppSettingsUpdate = Partial<
  Pick<AppSettings, "auto_sync_enabled" | "sync_interval_minutes" | "auto_import_enabled" | "import_interval_minutes">
>;

export interface EmployeeSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  // resigned/suspended, or missing/oversized EmpID or name
  ignored: number;
  accounts_created: number; // login accounts created for employees who had none
}

export interface TimeMintImportRequest {
  employee_id: number;
  date_start: string; // YYYY-MM-DD
  date_end: string; // YYYY-MM-DD, inclusive
  save: boolean; // false = preview only
}

export type ImportedAttendanceDay = Omit<NewAttendance, "employee_id">;

export type AttendanceReportRowType = "checklog" | "leave" | "holiday" | "company_holiday" | "absence" | "none";

/** One row of TimeMint's attendance report (same columns as the HR1.xlsx export). */
export interface AttendanceReportRow {
  emp_code: string; // Employee ID
  employee_name: string; // Employee name
  position: string | null; // Position
  date: string; // Date (YYYY-MM-DD)
  start_work_at: string | null; // Start work at (null = "-")
  get_off_work_at: string | null; // Get off work at
  time_in: string | null; // Time (in)
  time_out: string | null; // Time (out)
  notice: string | null; // Notice
  overtime_request_history: string | null; // Overtime request history
  place: string | null; // Place
  row_type: AttendanceReportRowType;
  checklog_id: string | null;
  // Extra columns (not in the export) used by the allowance report
  day_type: AttendanceDayType;
  holiday_name: string | null;
  department: string | null;
  approver_code: string | null; // EmpApproverID of the direct superior
}

export type AttendanceDayType = "workday" | "holiday" | "company_holiday";

// uncounted: worked a workday but "no check-in" (missing or >1h late), "no check-out"
// (missing or before 13:00), or first-in to last-out not more than 4h, so not counted for allowance
export type AllowanceDayKind = "work" | "uncounted" | "holiday_work" | "leave" | "holiday" | "absence" | "none";

export interface AllowanceReportDay {
  date: string;
  kind: AllowanceDayKind;
  time: string | null; // "08:00-17:00"
  site: string | null; // places, leave type, or "X" for a holiday off
  note: string | null; // holiday name, hourly leave, incomplete check-in/out
  work_day: boolean; // counts as a work day for the return-home bonus (lib/dayRules.ts)
  company_holiday: boolean; // TimeMint annual (company) holiday, as opposed to a weekly holiday
}

/** Monthly "Other Income for Allowance" report, built from stored attendance_report rows. */
export interface AllowanceReport {
  employee_id: number;
  emp_code: string;
  employee_name: string;
  position: string | null;
  department: string | null;
  direct_superior: string | null;
  site: string | null; // most frequent place in the month
  month: number;
  year: number;
  base_allowance: number; // site allowance per normal work day
  days: AllowanceReportDay[];
  imported_days: number; // dates in the month that have attendance_report rows
}

export interface TimeMintImportResult {
  employee_id: number;
  emp_code: string;
  date_start: string;
  date_end: string;
  report_rows: AttendanceReportRow[];
  days: ImportedAttendanceDay[];
  unmatched_locations: string[]; // places with no location_rates row (travel fee = 0)
  warnings: string[];
  saved: boolean;
  replaced: number; // existing attendance rows deleted in the range (only when saved)
}

export interface MileageEntry {
  date: string;
  seq: number; // leg of the day: 1 = accommodation -> first place, 2 = first -> second place, ...
  time: string | null;
  from_place: string | null;
  to_place: string | null;
  km: number;
  site: string | null;
}

export interface MileageOtherItem {
  description: string;
  period: string | null;
  amount: number;
}

/** "Other Income for Mileage and Telephone Charge" data for one employee and month. */
export interface MileageForm {
  employee_id: number;
  emp_code: string;
  employee_name: string;
  position: string | null;
  department: string | null;
  direct_superior: string | null;
  site: string | null;
  month: number;
  year: number;
  rate_per_km: number;
  remarks: string | null;
  telephone_amount: number; // this month's saved value, else the latest saved in an earlier month, else 0
  telephone_source: "this_month" | "last_saved" | "none";
  return_home_amount: number; // welfare rule 4 for this month (lib/dayRules.ts returnHomeBonus)
  days: AllowanceReportDay[]; // day kind and shift time
  day_places: Record<string, string[]>; // date -> check-in places in time order (repeats in a row collapsed); one leg each
  entries: MileageEntry[]; // submitted rows
  other_items: MileageOtherItem[];
  imported_days: number;
}

export interface MileageEntryRequest extends MileageEntry {
  employee_id: number;
}

export interface MileageClaimRequest {
  employee_id: number;
  month: number;
  year: number;
  rate_per_km: number;
  telephone_amount: number;
  remarks: string | null;
  other_items: MileageOtherItem[];
}

export type UserRole = "user" | "admin";

export interface AuthUser {
  user_id: number;
  username: string;
  role: UserRole;
  employee_id: number | null; // null for admin-only accounts
  employee_name: string | null;
  must_change_password: boolean;
}

export interface CompanyImportEmployee {
  employee_id: number;
  emp_code: string;
  name: string;
  report_rows: number;
  days: number; // daily attendance rows (welfare calculation)
  overtime_requests: number;
  warnings: string[];
}

/** Result of importing every employee's attendance with TimeMint GetByCom calls. */
export interface CompanyImportResult {
  date_start: string;
  date_end: string;
  employees: CompanyImportEmployee[];
  not_in_timemint: string[]; // MARR emp_codes TimeMint returned nothing for
  not_in_marr: string[]; // TimeMint EmpIDs with no MARR employee (run the employee sync)
  warnings: string[]; // optional sources that failed
  seconds: number;
}

export interface LeaveDays {
  personal: number; // ลากิจ
  sick: number; // ลาป่วย
  vacation: number; // ลาพักร้อน
}

export interface TimeMintReportDay {
  date: string;
  work_time: string | null; // "08:00 17:00"
  record: string | null; // first check-in and last check-out, "07:31 18:00"
  places: string[]; // one line per check-log: "[07:31->18:00] > [ BlueScope ]"
  note: string | null; // leave type (Thai) or company holiday name when there are no check-logs
  leave: LeaveDays;
  company_holiday: boolean;
  weekly_holiday: boolean;
}

/** TimeMint-style monthly attendance report (Welfare Summary > TimeMint), from stored attendance_report rows. */
export interface TimeMintMonthReport {
  employee_id: number;
  emp_code: string;
  employee_name: string;
  month: number;
  year: number;
  days: TimeMintReportDay[];
  totals: LeaveDays;
  worked_days: number; // days with at least one check-log
  imported_days: number;
  generated_at: string;
}

export type OtRowStatus = "approved" | "pending" | "rejected" | "no_request";

/** One line of the OT & work-on-holiday form: an OT request (any status) or a worked holiday without one. */
export interface OtFormRow {
  date: string;
  overtime_id: string | null;
  requested_start: string | null; // "17:00"
  requested_end: string | null;
  requested_minutes: number;
  actual_start: string | null; // first check-in time inside the requested window (or of the day when no request)
  actual_end: string | null; // last check-out time inside that window
  worked_minutes: number; // check-in time overlapping the request (welfare rule 3)
  hours: number; // rounded OT hours (remainder < 20 min dropped, >= 20 min up)
  status: OtRowStatus;
  holiday: string | null; // "วันหยุดบริษัท (<name>)" / "วันหยุดประจำสัปดาห์" when the date is a holiday
  place: string | null;
  description: string | null; // OT reason, else its type
}

export interface OtForm {
  employee_id: number;
  emp_code: string;
  employee_name: string;
  position: string | null;
  month: number;
  year: number;
  rows: OtFormRow[];
  approved_hours: number; // what welfare rule 3 pays
  pending_hours: number; // would be added once approved
  imported_days: number;
}

/** One row of the Fixed Time Request page (table time_adjustment_request). */
export interface FixedTimeRequestRow {
  record_no: string;
  record_type: string | null;
  date: string;
  from_time_in: string | null;
  from_time_out: string | null;
  to_time_in: string | null;
  to_time_out: string | null;
  reason: string | null;
  added_by: string | null;
  created_date: string | null;
  status: string | null;
  approver: string | null;
  image_url: string | null; // http(s) only
}

export interface FixHistoryEmployeeResult {
  employee_id: number;
  emp_code: string;
  name: string;
  saved: number;
  skipped: number; // rows without a readable record number or date
  error: string | null;
}

export interface FixedTimeRequestReport {
  employee_id: number;
  emp_code: string;
  employee_name: string;
  position: string | null;
  month: number;
  year: number;
  rows: FixedTimeRequestRow[];
}

export type LoginHistoryEvent = "login" | "logout";

/** One row of the Settings > Login History list (table login_history). */
export interface LoginHistoryRow {
  id: number;
  username: string;
  employee_name: string | null;
  role: UserRole;
  event: LoginHistoryEvent;
  created_at: string;
}

export interface ApiError {
  error: string;
}
