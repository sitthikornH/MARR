// The only allowed values for employees.return_home_rate (THB per month), chosen by home distance.
// Shared by the Employees page and the employee API routes; no DB access.
export const RETURN_HOME_OPTIONS = [
  { value: 0, label: "ไม่มีค่ากลับบ้าน" },
  { value: 1000, label: "D < 350 กม" },
  { value: 2000, label: "D > 350 กม" },
] as const;

export function isReturnHomeOption(value: unknown): value is number {
  return typeof value === "number" && RETURN_HOME_OPTIONS.some((o) => o.value === value);
}

export function returnHomeLabel(value: number): string {
  return RETURN_HOME_OPTIONS.find((o) => o.value === value)?.label ?? `${value.toFixed(2)} (not a standard option)`;
}

export const RETURN_HOME_ERROR = `return_home_rate must be one of ${RETURN_HOME_OPTIONS.map((o) => o.value).join(", ")}`;
