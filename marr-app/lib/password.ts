// Password hashing with Node's built-in scrypt (no extra dependency). Format:
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// scripts/create-admin.mjs writes the same format.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Phone numbers are compared as digits only: "095-678 5278" -> "0956785278". */
export const phoneDigits = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "");

/** Employee PIN rule: exactly 4 digits. */
export const isValidPin = (value: string) => /^\d{4}$/.test(value);

/** Admin password rule: at least 8 characters. */
export const isValidAdminPassword = (value: string) => value.length >= 8;
