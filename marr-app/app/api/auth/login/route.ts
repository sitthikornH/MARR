import { NextRequest, NextResponse } from "next/server";
import { execute, query, type RowDataPacket } from "@/lib/db";
import { startSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import type { ApiError } from "@/lib/types";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** POST { username, password }: signs in. 5 wrong passwords in a row lock the account for 15 minutes. */
export async function POST(request: NextRequest): Promise<NextResponse<{ success: true } | ApiError>> {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, password_hash, failed_attempts, locked_until > NOW() AS locked,
              TIMESTAMPDIFF(MINUTE, NOW(), locked_until) + 1 AS minutes_left
       FROM users WHERE username = ?`,
      [username]
    );
    const user = rows[0];
    const invalid = NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
    if (!user) return invalid;
    if (user.locked) {
      return NextResponse.json(
        { error: `Too many wrong attempts. Try again in ${user.minutes_left} minute(s).` },
        { status: 423 }
      );
    }
    const userId: number = user.id;

    if (!user.password_hash) {
      return NextResponse.json({ error: "No password set for this account yet. Please ask an admin." }, { status: 401 });
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      const failed: number = Number(user.failed_attempts) + 1;
      if (failed >= MAX_FAILED_ATTEMPTS) {
        await execute(
          "UPDATE users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?",
          [LOCK_MINUTES, userId]
        );
        return NextResponse.json(
          { error: `Too many wrong attempts. The account is locked for ${LOCK_MINUTES} minutes.` },
          { status: 423 }
        );
      }
      await execute("UPDATE users SET failed_attempts = ? WHERE id = ?", [failed, userId]);
      return invalid;
    }

    await execute("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?", [userId]);
    const response = NextResponse.json({ success: true as const }, { status: 200 });
    await startSession(response, request, userId);
    return response;
  } catch (error) {
    console.error("POST /api/auth/login failed:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
