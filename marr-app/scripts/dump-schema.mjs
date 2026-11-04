// Writes the live database structure (no data) to db/schema_<version>.sql.
//   npm run dump-schema -- MARR-V.2
// Uses SHOW CREATE TABLE, so the file is exactly what MySQL has now. AUTO_INCREMENT counters are
// stripped (they depend on data). Restore: mysql -u root -p < db/schema_<version>.sql
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mysql from "mysql2/promise";

const version = process.argv[2];
if (!version) {
  console.error("Usage: npm run dump-schema -- <version, e.g. MARR-V.2>");
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^(\w+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const database = env.DB_NAME || "marr_db";

const db = await mysql.createConnection({
  host: env.DB_HOST || "localhost",
  port: Number(env.DB_PORT) || 3306,
  user: env.DB_USER || "root",
  password: env.DB_PASSWORD || "",
  database,
});
try {
  const [[{ version: mysqlVersion }]] = await db.query("SELECT VERSION() AS version");
  const [tables] = await db.query(
    "SELECT TABLE_NAME AS name, TABLE_ROWS AS approx_rows FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    [database]
  );

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const out = [
    `-- Project MARR database structure, ${version}`,
    `-- Dumped ${stamp} UTC from ${database} (MySQL ${mysqlVersion}) by scripts/dump-schema.mjs.`,
    "-- Structure only, no data. Restore into an empty server: mysql -u root -p < this file",
    "",
    `CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4;`,
    `USE \`${database}\`;`,
    "",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "",
  ];
  for (const { name } of tables) {
    const [[row]] = await db.query(`SHOW CREATE TABLE \`${name}\``);
    const ddl = row["Create Table"].replace(/ AUTO_INCREMENT=\d+/, "").replace(/^CREATE TABLE/, "CREATE TABLE IF NOT EXISTS");
    out.push(`-- ${name}`, `${ddl};`, "");
  }
  out.push("SET FOREIGN_KEY_CHECKS = 1;", "", "-- Single-row settings the app expects", "INSERT IGNORE INTO app_settings (id) VALUES (1);", "");

  const dir = path.join(root, "db");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `schema_${version}.sql`);
  writeFileSync(file, out.join("\n"), "utf8");
  console.log(`Wrote ${path.relative(root, file)}: ${tables.length} tables`);
  for (const t of tables) console.log(`  ${t.name}`);
} finally {
  await db.end();
}
