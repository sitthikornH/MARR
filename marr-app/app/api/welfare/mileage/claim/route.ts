import { NextRequest, NextResponse } from "next/server";
import { canAccessEmployee, forbidden, requireAuth } from "@/lib/auth";
import pool, { type ResultSetHeader } from "@/lib/db";
import type { ApiError, MileageClaimRequest, MileageOtherItem } from "@/lib/types";

/**
 * PUT: saves the month's claim settings (rate per km, telephone amount, remarks) and replaces its
 * extra other-income lines.
 */
export async function PUT(request: NextRequest): Promise<NextResponse<{ success: true } | ApiError>> {
  const gate = await requireAuth(request);
  if ("response" in gate) return gate.response;
  let body: Partial<MileageClaimRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { employee_id, month, year, rate_per_km, other_items } = body;
  if (
    !Number.isInteger(employee_id) ||
    !Number.isInteger(month) ||
    (month as number) < 1 ||
    (month as number) > 12 ||
    !Number.isInteger(year)
  ) {
    return NextResponse.json({ error: "employee_id, month (1-12), and year are required" }, { status: 400 });
  }
  if (typeof rate_per_km !== "number" || !Number.isFinite(rate_per_km) || rate_per_km < 0) {
    return NextResponse.json({ error: "rate_per_km must be a number >= 0" }, { status: 400 });
  }
  const { telephone_amount } = body;
  if (typeof telephone_amount !== "number" || !Number.isFinite(telephone_amount) || telephone_amount < 0) {
    return NextResponse.json({ error: "telephone_amount must be a number >= 0" }, { status: 400 });
  }
  const items: MileageOtherItem[] = Array.isArray(other_items) ? other_items : [];
  for (const item of items) {
    if (typeof item?.description !== "string" || !item.description.trim()) {
      return NextResponse.json({ error: "Every other-income line needs a description" }, { status: 400 });
    }
    if (typeof item.amount !== "number" || !Number.isFinite(item.amount)) {
      return NextResponse.json({ error: "Every other-income line needs a numeric amount" }, { status: 400 });
    }
  }

  const employeeId: number = employee_id as number;
  if (!canAccessEmployee(gate.auth, employeeId)) return forbidden();
  const monthNum: number = month as number;
  const yearNum: number = year as number;
  const rate: number = rate_per_km;
  const telephone: number = telephone_amount;
  const remarks: string | null = typeof body.remarks === "string" && body.remarks.trim() ? body.remarks.trim() : null;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [claim] = await connection.execute<ResultSetHeader>(
      `INSERT INTO mileage_claim (employee_id, month, year, rate_per_km, telephone_amount, remarks) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), rate_per_km = VALUES(rate_per_km),
         telephone_amount = VALUES(telephone_amount), remarks = VALUES(remarks)`,
      [employeeId, monthNum, yearNum, rate, telephone, remarks]
    );
    const claimId: number = claim.insertId;

    await connection.execute("DELETE FROM mileage_other_item WHERE claim_id = ?", [claimId]);
    for (const item of items) {
      const period: string | null = typeof item.period === "string" && item.period.trim() ? item.period.trim().slice(0, 50) : null;
      await connection.execute(
        "INSERT INTO mileage_other_item (claim_id, description, period, amount) VALUES (?, ?, ?, ?)",
        [claimId, item.description.trim().slice(0, 255), period, item.amount]
      );
    }
    await connection.commit();
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === "ER_NO_REFERENCED_ROW_2") {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    console.error("PUT /api/welfare/mileage/claim failed:", error);
    return NextResponse.json({ error: "Failed to save mileage claim" }, { status: 500 });
  } finally {
    connection.release();
  }
}
