export interface Employee {
  id: number;
  emp_code: string;
  name: string;
  base_allowance: number;
  base_ot_rate: number;
  return_home_rate: number;
  created_at: string;
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
  base_days: number; // days in month - Sundays - vacation/sick/personal leave days
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
}

export type AppSettingsUpdate = Pick<AppSettings, "auto_sync_enabled" | "sync_interval_minutes">;

export interface EmployeeSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  // resigned/suspended, or missing/oversized EmpID or name
  ignored: number;
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

export interface ApiError {
  error: string;
}
