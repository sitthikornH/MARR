import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { query, type RowDataPacket } from "@/lib/db";
import type { ApiError, LoginHistoryRow } from "@/lib/types";

interface HistoryRow extends RowDataPacket, LoginHistoryRow {}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * GET ?q=&event=login|logout&limit= (admin) — searches login_history by username/employee name,
 * newest first. q matches either field as a substring.
 */
export async function GET(request: NextRequest): Promise<NextResponse<LoginHistoryRow[] | ApiError>> {
  const gate = await requireAuth(request, { admin: true });
  if ("response" in gate) return gate.response;

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  const eventParam = params.get("event");
  const event: "login" | "logout" | null = eventParam === "login" || eventParam === "logout" ? eventParam : null;
  const limitParam = Number(params.get("limit"));
  const limit: number = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= MAX_LIMIT ? limitParam : DEFAULT_LIMIT;

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (q) {
    conditions.push("(username LIKE ? OR employee_name LIKE ?)");
    values.push(`%${q}%`, `%${q}%`);
  }
  if (event) {
    conditions.push("event = ?");
    values.push(event);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const rows = await query<HistoryRow[]>(
      `SELECT id, username, employee_name, role, event, created_at FROM login_history
       ${where} ORDER BY created_at DESC LIMIT ?`,
      [...values, limit]
    );
    return NextResponse.json(rows, { status: 200 });
  } catch (error) {
    console.error("GET /api/login-history failed:", error);
    return NextResponse.json({ error: "Failed to load login history" }, { status: 500 });
  }
}
