// Row highlight for the printable forms (allowance report, mileage form). Class names are written
// out in full so Tailwind picks them up.
import type { AllowanceReportDay } from "@/lib/types";

export interface DayHighlight {
  bg: string; // screen and print background
  printBg: string; // same colour for print only (used when the screen shows another state)
}

const COMPANY_HOLIDAY: DayHighlight = { bg: "bg-rose-100", printBg: "print:bg-rose-100" };
const LEAVE: DayHighlight = { bg: "bg-sky-100", printBg: "print:bg-sky-100" };
const WEEKLY_HOLIDAY: DayHighlight = { bg: "bg-gray-100", printBg: "print:bg-gray-100" };
const NONE: DayHighlight = { bg: "", printBg: "print:bg-transparent" };

/** Company holidays (rose) and leave days (sky) are highlighted; weekly holidays stay grey. */
export function dayHighlight(day: AllowanceReportDay): DayHighlight {
  if (day.company_holiday) return COMPANY_HOLIDAY;
  if (day.kind === "leave") return LEAVE;
  if (day.kind === "holiday" || day.kind === "holiday_work") return WEEKLY_HOLIDAY;
  return NONE;
}

/** Browsers drop background colours when printing unless told otherwise. */
export const PRINT_COLORS_CSS = "* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }";
