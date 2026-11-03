// Creates or updates an admin login.
//   npm run create-admin -- <username> <password> [emp_code]
// With emp_code the admin account is linked to that employee (replacing their employee account).
// Reads DB settings from .env.local. Uses the same scrypt format as lib/password.ts.
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mysql from "mysql2/promise";

const [usernameArg, password, empCode] = process.argv.slice(2);
if (!usernameArg || !password) {
  console.error("Usage: npm run create-admin -- <username> <password> [emp_code]");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Admin password must be at least 8 characters.");
  process.exit(1);
}
const username = usernameArg.trim().toLowerCase();

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^(\w+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const N = 16384, R = 8, P = 1;
const salt = randomBytes(16);
const key = scryptSync(password, salt, 64, { N, r: R, p: P });
const hash = `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;

const db = await mysql.createConnection({
  host: env.DB_HOST || "localhost",
  port: Number(env.DB_PORT) || 3306,
  user: env.DB_USER || "root",
  password: env.DB_PASSWORD || "",
  database: env.DB_NAME || "marr_db",
});
try {
  let employeeId = null;
  if (empCode) {
    const [rows] = await db.execute("SELECT id FROM employees WHERE emp_code = ?", [empCode]);
    if (rows.length === 0) throw new Error(`No employee with emp_code ${empCode}`);
    employeeId = rows[0].id;
    await db.execute("DELETE FROM users WHERE employee_id = ? AND username <> ?", [employeeId, username]);
  }
  await db.execute(
    `INSERT INTO users (employee_id, username, password_hash, role, must_change_password)
     VALUES (?, ?, ?, 'admin', 0)
     ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id), password_hash = VALUES(password_hash),
       role = 'admin', must_change_password = 0, failed_attempts = 0, locked_until = NULL`,
    [employeeId, username, hash]
  );
  console.log(`Admin "${username}" is ready${empCode ? ` (linked to ${empCode})` : ""}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
