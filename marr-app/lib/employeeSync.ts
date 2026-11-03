import type { PoolConnection } from "mysql2/promise";
import pool, { execute, query, type ResultSetHeader, type RowDataPacket } from "@/lib/db";
import { hashPassword, phoneDigits } from "@/lib/password";
import { callTimeMint, getToken } from "@/lib/timemint";
import type { AppSettings, EmployeeSyncResult, SyncStatus } from "@/lib/types";

// Shared by the sync route handler and the background scheduler (instrumentation.ts),
// which is why this module imports lib/db directly.

export const SYNC_INTERVAL_OPTIONS = [15, 30, 60, 180, 360, 720, 1440];

export async function getSettings(): Promise<AppSettings> {
  const rows = await query<RowDataPacket[]>(
    "SELECT auto_sync_enabled, sync_interval_minutes, last_sync_at, last_sync_status, last_sync_message FROM app_settings WHERE id = 1"
  );
  const row = rows[0];
  if (!row) {
    return {
      auto_sync_enabled: false,
      sync_interval_minutes: 60,
      last_sync_at: null,
      last_sync_status: null,
      last_sync_message: null,
    };
  }
  return {
    auto_sync_enabled: Boolean(row.auto_sync_enabled),
    sync_interval_minutes: Number(row.sync_interval_minutes),
    last_sync_at: row.last_sync_at,
    last_sync_status: row.last_sync_status,
    last_sync_message: row.last_sync_message,
  };
}

async function recordSyncOutcome(status: SyncStatus, message: string): Promise<void> {
  const trimmed: string = message.slice(0, 500);
  await execute(
    "UPDATE app_settings SET last_sync_at = NOW(), last_sync_status = ?, last_sync_message = ? WHERE id = 1",
    [status, trimmed]
  );
}

const EMP_CODE_MAX = 20; // employees.emp_code VARCHAR(20)
const NAME_MAX = 100; // employees.name VARCHAR(100)

interface TimeMintEmployee {
  EmpID: string | null;
  EmpNameTH: string | null;
  EmpNameEN: string | null;
  EmpEmail: string | null;
  EmpTel: string | null;
  EmpResignDate: string | null;
  EmployeeActiveStatus: number | null;
}

interface SourceEmployee {
  emp_code: string;
  name: string;
  email_local: string | null; // email part before "@", lowercase
  phone: string; // digits only; used once as the first password, never stored
}

const emailLocalPart = (email: string | null) => {
  const local = (email ?? "").trim().toLowerCase().split("@")[0];
  return local && (email ?? "").includes("@") ? local.slice(0, 100) : null;
};

/**
 * Creates the login account for an employee who has none: username = email part before "@"
 * (or emp_code when there is no email, the part is shared by several employees, or it is taken),
 * first password = phone number, must change to a 4-digit PIN at first login. Returns false when
 * the employee already has an account or no free username exists. Existing accounts are untouched.
 */
export async function createEmployeeAccount(
  connection: PoolConnection,
  employeeId: number,
  empCode: string,
  emailLocal: string | null,
  phone: string
): Promise<boolean> {
  const id: number = employeeId;
  const [existing] = await connection.execute<RowDataPacket[]>("SELECT id FROM users WHERE employee_id = ?", [id]);
  if (existing.length > 0) return false;

  for (const candidate of [emailLocal, empCode.toLowerCase()]) {
    if (!candidate) continue;
    const username: string = candidate;
    const [taken] = await connection.execute<RowDataPacket[]>("SELECT id FROM users WHERE username = ?", [username]);
    if (taken.length > 0) continue;
    const hash: string | null = phone ? await hashPassword(phone) : null;
    await connection.execute(
      "INSERT INTO users (employee_id, username, password_hash, role, must_change_password) VALUES (?, ?, ?, 'user', 1)",
      [id, username, hash]
    );
    return true;
  }
  return false;
}

function hasResigned(e: TimeMintEmployee): boolean {
  if (e.EmployeeActiveStatus === 99) return true;
  const resign = e.EmpResignDate;
  if (!resign || resign.startsWith("0000")) return false;
  return resign <= new Date().toISOString().slice(0, 10);
}

function mapRecord(e: TimeMintEmployee): SourceEmployee | null {
  const code = (e.EmpID ?? "").trim();
  const name = (e.EmpNameTH || e.EmpNameEN || "").trim();
  if (!code || !name || code.length > EMP_CODE_MAX) return null;
  return { emp_code: code, name: name.slice(0, NAME_MAX), email_local: emailLocalPart(e.EmpEmail), phone: phoneDigits(e.EmpTel) };
}

async function fetchSourceEmployees(): Promise<{ records: SourceEmployee[]; fetched: number; ignored: number }> {
  const token = await getToken("Employee");
  const employees = await callTimeMint<TimeMintEmployee[]>(
    { name: "GetEmpData", param: { Service: "GetByCom" } },
    token
  );

  const records = employees
    .filter((e) => !hasResigned(e))
    .map(mapRecord)
    .filter((e): e is SourceEmployee => e !== null);
  return { records, fetched: employees.length, ignored: employees.length - records.length };
}

let syncInProgress = false;

export async function runEmployeeSync(): Promise<EmployeeSyncResult> {
  if (syncInProgress) throw new Error("A sync is already running");
  syncInProgress = true;

  try {
    const { records, fetched, ignored } = await fetchSourceEmployees();
    const result: EmployeeSyncResult = { fetched, inserted: 0, updated: 0, skipped: 0, ignored, accounts_created: 0 };

    // An email part shared by several employees can't be anyone's username; they fall back to emp_code.
    const localCounts = new Map<string, number>();
    for (const r of records) if (r.email_local) localCounts.set(r.email_local, (localCounts.get(r.email_local) ?? 0) + 1);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const record of records) {
        // New employees get the default (0) welfare rates; existing rates are never overwritten.
        const [res] = await connection.execute<ResultSetHeader>(
          "INSERT INTO employees (emp_code, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
          [record.emp_code, record.name]
        );
        // affectedRows: 1 = inserted, 2 = updated, 0 = unchanged
        if (res.affectedRows === 1) result.inserted++;
        else if (res.affectedRows === 2) result.updated++;
        else result.skipped++;

        const [idRows] = await connection.execute<RowDataPacket[]>("SELECT id FROM employees WHERE emp_code = ?", [
          record.emp_code,
        ]);
        const emailLocal = record.email_local && localCounts.get(record.email_local) === 1 ? record.email_local : null;
        if (await createEmployeeAccount(connection, idRows[0].id, record.emp_code, emailLocal, record.phone)) {
          result.accounts_created++;
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await recordSyncOutcome(
      "success",
      `Fetched ${result.fetched}: ${result.inserted} new, ${result.updated} updated, ${result.skipped} unchanged, ${result.ignored} ignored, ${result.accounts_created} login account(s) created`
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordSyncOutcome("error", message).catch(() => {});
    throw error;
  } finally {
    syncInProgress = false;
  }
}
