import { NextRequest, NextResponse } from "next/server";
import { canAccessEmployee, forbidden, requireAuth } from "@/lib/auth";
import { execute, query, type RowDataPacket } from "@/lib/db";
import type { ApiError, MileageEntry, MileageEntryRequest } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** PUT: submits (inserts or replaces) one leg (date + seq) of mileage; the month's claim is created on first use. */
export async function PUT(request: NextRequest): Promise<NextResponse<MileageEntry | ApiError>> {
  const gate = await requireAuth(request);
  if ("response" in gate) return gate.response;
  let body: Partial<MileageEntryRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { employee_id, date, km } = body;
  if (!Number.isInteger(employee_id) || typeof date !== "string" || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "employee_id and date (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (typeof km !== "number" || !Number.isFinite(km) || km < 0) {
    return NextResponse.json({ error: "km must be a number >= 0" }, { status: 400 });
  }
  const seq = body.seq ?? 1;
  if (!Number.isInteger(seq) || seq < 1) {
    return NextResponse.json({ error: "seq must be an integer >= 1" }, { status: 400 });
  }
  const legSeq: number = seq;
  const employeeId: number = employee_id as number;
  if (!canAccessEmployee(gate.auth, employeeId)) return forbidden();
  const entryDate: string = date;
  const kmValue: number = km;
  const year: number = Number(entryDate.slice(0, 4));
  const month: number = Number(entryDate.slice(5, 7));

  try {
    const employees = await query<RowDataPacket[]>("SELECT id FROM employees WHERE id = ?", [employeeId]);
    if (employees.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Get-or-create the month's claim; LAST_INSERT_ID(id) makes insertId the existing id on duplicates.
    const claim = await execute(
      `INSERT INTO mileage_claim (employee_id, month, year) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [employeeId, month, year]
    );
    const claimId: number = claim.insertId;

    const entry: MileageEntry = {
      date: entryDate,
      seq: legSeq,
      time: text(body.time, 20),
      from_place: text(body.from_place, 255),
      to_place: text(body.to_place, 255),
      km: kmValue,
      site: text(body.site, 100),
    };
    await execute(
      `INSERT INTO mileage_entry (claim_id, date, seq, time, from_place, to_place, km, site)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE time = VALUES(time), from_place = VALUES(from_place),
         to_place = VALUES(to_place), km = VALUES(km), site = VALUES(site)`,
      [claimId, entry.date, entry.seq, entry.time, entry.from_place, entry.to_place, entry.km, entry.site]
    );

    return NextResponse.json(entry, { status: 200 });
  } catch (error) {
    console.error("PUT /api/welfare/mileage/entry failed:", error);
    return NextResponse.json({ error: "Failed to save mileage entry" }, { status: 500 });
  }
}
