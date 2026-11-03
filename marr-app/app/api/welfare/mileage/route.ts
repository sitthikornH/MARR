import { NextRequest, NextResponse } from "next/server";
import { query, type RowDataPacket } from "@/lib/db";
import { classifyMonth, returnHomeBonus, type DayRuleRow } from "@/lib/dayRules";
import type { ApiError, MileageEntry, MileageForm, MileageOtherItem } from "@/lib/types";

interface ReportRow extends RowDataPacket, DayRuleRow {
  employee_name: string;
  position: string | null;
  department: string | null;
  approver_code: string | null;
}

/**
 * GET ?employee_id=&month=&year= — the month's "Other Income for Mileage and Telephone Charge"
 * form: header and per-day check-in places from the stored attendance_report rows, plus the
 * mileage rows and other-income lines already submitted.
 */
export async function GET(request: NextRequest): Promise<NextResponse<MileageForm | ApiError>> {
  const params = request.nextUrl.searchParams;
  const employeeIdNum = Number(params.get("employee_id"));
  const monthNum = Number(params.get("month"));
  const yearNum = Number(params.get("year"));

  if (!Number.isInteger(employeeIdNum) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12 || !Number.isInteger(yearNum)) {
    return NextResponse.json({ error: "employee_id, month (1-12), and year are required" }, { status: 400 });
  }
  const employeeId: number = employeeIdNum;
  const month: number = monthNum;
  const year: number = yearNum;

  try {
    const employees = await query<RowDataPacket[]>(
      "SELECT id, emp_code, name, return_home_rate FROM employees WHERE id = ?",
      [employeeId]
    );
    if (employees.length === 0) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const employee = employees[0];

    const rows = await query<ReportRow[]>(
      `SELECT date, employee_name, position, department, approver_code, start_work_at, get_off_work_at,
              time_in, time_out, notice, place, row_type, day_type, holiday_name
       FROM attendance_report
       WHERE employee_id = ? AND YEAR(date) = ? AND MONTH(date) = ?
       ORDER BY date ASC, id ASC`,
      [employeeId, year, month]
    );

    const placeCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.row_type === "checklog" && row.place) placeCounts.set(row.place, (placeCounts.get(row.place) ?? 0) + 1);
    }
    const site = [...placeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const latest = rows[rows.length - 1];
    let directSuperior: string | null = latest?.approver_code ?? null;
    if (directSuperior) {
      const superiors = await query<RowDataPacket[]>("SELECT name FROM employees WHERE emp_code = ?", [directSuperior]);
      if (superiors.length > 0) directSuperior = `${superiors[0].name} (${directSuperior})`;
    }

    const claims = await query<RowDataPacket[]>(
      "SELECT id, rate_per_km, telephone_amount, remarks FROM mileage_claim WHERE employee_id = ? AND month = ? AND year = ?",
      [employeeId, month, year]
    );
    const claim = claims[0];

    // Telephone: this month's saved amount, else the most recent amount saved in an earlier month.
    let telephoneAmount = 0;
    let telephoneSource: MileageForm["telephone_source"] = "none";
    if (claim && claim.telephone_amount !== null) {
      telephoneAmount = Number(claim.telephone_amount);
      telephoneSource = "this_month";
    } else {
      const previous = await query<RowDataPacket[]>(
        `SELECT telephone_amount FROM mileage_claim
         WHERE employee_id = ? AND telephone_amount IS NOT NULL AND (year < ? OR (year = ? AND month < ?))
         ORDER BY year DESC, month DESC LIMIT 1`,
        [employeeId, year, year, month]
      );
      if (previous.length > 0) {
        telephoneAmount = Number(previous[0].telephone_amount);
        telephoneSource = "last_saved";
      }
    }
    let entries: MileageEntry[] = [];
    let otherItems: MileageOtherItem[] = [];
    if (claim) {
      const claimId: number = claim.id;
      const entryRows = await query<RowDataPacket[]>(
        "SELECT date, time, from_place, to_place, km, site FROM mileage_entry WHERE claim_id = ? ORDER BY date",
        [claimId]
      );
      entries = entryRows.map((r) => ({
        date: r.date,
        time: r.time,
        from_place: r.from_place,
        to_place: r.to_place,
        km: Number(r.km),
        site: r.site,
      }));
      const itemRows = await query<RowDataPacket[]>(
        "SELECT description, period, amount FROM mileage_other_item WHERE claim_id = ? ORDER BY id",
        [claimId]
      );
      otherItems = itemRows.map((r) => ({ description: r.description, period: r.period, amount: Number(r.amount) }));
    }

    const form: MileageForm = {
      employee_id: employeeId,
      emp_code: employee.emp_code,
      employee_name: latest?.employee_name ?? employee.name,
      position: latest?.position ?? null,
      department: latest?.department ?? null,
      direct_superior: directSuperior,
      site,
      month,
      year,
      rate_per_km: claim ? Number(claim.rate_per_km) : 5,
      remarks: claim?.remarks ?? null,
      telephone_amount: telephoneAmount,
      telephone_source: telephoneSource,
      return_home_amount: returnHomeBonus(year, month, rows, Number(employee.return_home_rate)).amount,
      days: classifyMonth(year, month, rows),
      entries,
      other_items: otherItems,
      imported_days: new Set(rows.map((r) => r.date)).size,
    };
    return NextResponse.json(form, { status: 200 });
  } catch (error) {
    console.error("GET /api/welfare/mileage failed:", error);
    return NextResponse.json({ error: "Failed to load mileage form" }, { status: 500 });
  }
}
