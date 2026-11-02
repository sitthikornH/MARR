import pool, { execute, query, type ResultSetHeader, type RowDataPacket } from "@/lib/db";
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
  EmpResignDate: string | null;
  EmployeeActiveStatus: number | null;
}

interface SourceEmployee {
  emp_code: string;
  name: string;
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
  return { emp_code: code, name: name.slice(0, NAME_MAX) };
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
    const result: EmployeeSyncResult = { fetched, inserted: 0, updated: 0, skipped: 0, ignored };

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
      `Fetched ${result.fetched}: ${result.inserted} new, ${result.updated} updated, ${result.skipped} unchanged, ${result.ignored} ignored`
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
