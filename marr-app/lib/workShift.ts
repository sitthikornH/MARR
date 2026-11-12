// The only allowed values for employees.work_shift: the work-hours period used to decide late
// check-in (lib/dayRules.ts) and build attendance_report.start_work_at/get_off_work_at
// (lib/attendanceReport.ts), overriding whatever TimeMint reports for that employee. Shared by the
// Employees page and the employee API routes; no DB access.
export const WORK_SHIFT_OPTIONS = [
  { value: "08:00-17:00", label: "08:00 - 17:00" },
  { value: "08:30-17:30", label: "08:30 - 17:30" },
] as const;

export const DEFAULT_WORK_SHIFT: string = WORK_SHIFT_OPTIONS[0].value;

export function isWorkShiftOption(value: unknown): value is string {
  return typeof value === "string" && WORK_SHIFT_OPTIONS.some((o) => o.value === value);
}

export function workShiftLabel(value: string): string {
  return WORK_SHIFT_OPTIONS.find((o) => o.value === value)?.label ?? `${value} (not a standard option)`;
}

export const WORK_SHIFT_ERROR = `work_shift must be one of ${WORK_SHIFT_OPTIONS.map((o) => o.value).join(", ")}`;

/** "08:30-17:30" -> { start: "08:30:00", end: "17:30:00" } */
export function parseWorkShift(value: string): { start: string; end: string } {
  const [start, end] = value.split("-");
  return { start: `${start}:00`, end: `${end}:00` };
}
