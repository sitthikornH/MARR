import mysql, { type PoolOptions, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

const poolOptions: PoolOptions = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "marr_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
};

declare global {
  // eslint-disable-next-line no-var
  var __marrPool: mysql.Pool | undefined;
}

const pool: mysql.Pool = globalThis.__marrPool ?? mysql.createPool(poolOptions);

if (!globalThis.__marrPool) {
  globalThis.__marrPool = pool;
}

export default pool;

export async function query<T extends RowDataPacket[] = RowDataPacket[]>(
  sql: string,
  params: ReadonlyArray<unknown> = []
): Promise<T> {
  const [rows] = await pool.execute<T>(sql, params as any[]);
  return rows;
}

export async function execute(
  sql: string,
  params: ReadonlyArray<unknown> = []
): Promise<ResultSetHeader> {
  const [result] = await pool.execute<ResultSetHeader>(sql, params as any[]);
  return result;
}

export type { RowDataPacket, ResultSetHeader };
