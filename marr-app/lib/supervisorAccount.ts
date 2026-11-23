// Shared by app/api/supervisors/route.ts and app/api/supervisors/[id]/route.ts — kept out of
// either route.ts file since Next.js route handlers may only export recognized HTTP methods and
// config constants.
import { query, type RowDataPacket } from "@/lib/db";
import type { ReportAccess, SupervisorAccount } from "@/lib/types";

export const NO_REPORT_ACCESS: ReportAccess = { group_id: null, all: false };

export function isReportAccess(v: unknown): v is ReportAccess {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Partial<ReportAccess>;
  return typeof a.all === "boolean" && (a.group_id === null || (typeof a.group_id === "number" && Number.isInteger(a.group_id)));
}

/** `all: true` overrides `group_id` (normalized to null), so the two can never conflict in storage. */
export function normalizeReportAccess(a: ReportAccess): ReportAccess {
  return { group_id: a.all ? null : a.group_id, all: a.all };
}

/** Every referenced group id (deduplicated) must name an existing employee_groups row. */
export async function groupIdsExist(groupIds: number[]): Promise<boolean> {
  if (groupIds.length === 0) return true;
  const unique = [...new Set(groupIds)];
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM employee_groups WHERE id IN (${unique.map(() => "?").join(", ")})`,
    unique
  );
  return rows.length === unique.length;
}

export const SUPERVISOR_COLUMNS =
  "id, username, password_hash IS NOT NULL AS has_password, locked_until > NOW() AS locked, " +
  "can_manage_employees, can_manage_time_adjustment_history, " +
  "timemint_group_id, timemint_all, ot_group_id, ot_all, fixed_time_group_id, fixed_time_all, " +
  "allowance_group_id, allowance_all, mileage_group_id, mileage_all";

export function toSupervisorAccount(r: RowDataPacket): SupervisorAccount {
  return {
    id: r.id,
    username: r.username,
    has_password: Boolean(r.has_password),
    locked: Boolean(r.locked),
    can_manage_employees: Boolean(r.can_manage_employees),
    can_manage_time_adjustment_history: Boolean(r.can_manage_time_adjustment_history),
    timemint: { group_id: r.timemint_group_id, all: Boolean(r.timemint_all) },
    ot: { group_id: r.ot_group_id, all: Boolean(r.ot_all) },
    fixed_time: { group_id: r.fixed_time_group_id, all: Boolean(r.fixed_time_all) },
    allowance: { group_id: r.allowance_group_id, all: Boolean(r.allowance_all) },
    mileage: { group_id: r.mileage_group_id, all: Boolean(r.mileage_all) },
  };
}
