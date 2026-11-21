// Shared by app/api/supervisors/route.ts and app/api/supervisors/[id]/route.ts — kept out of
// either route.ts file since Next.js route handlers may only export recognized HTTP methods and
// config constants.
import type { RowDataPacket } from "@/lib/db";
import type { SupervisorAccount } from "@/lib/types";

export const SUPERVISOR_COLUMNS =
  "id, username, password_hash IS NOT NULL AS has_password, locked_until > NOW() AS locked, " +
  "can_manage_employees, can_manage_time_adjustment_history, " +
  "timemint_group_id, timemint_all, ot_group_id, ot_all, fixed_time_group_id, fixed_time_all";

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
  };
}
