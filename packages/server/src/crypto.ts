import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
export const hmac = (secret: string, msg: string): string => createHmac("sha256", secret).update(msg).digest("base64url");
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Fisher-Yates with a cryptographic source. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/* ---------- passwords: scrypt, parameters stored with the hash so they can be raised later ---------- */

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 128 * 1024 * 1024 };
const derive = (password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A real hash to compare against when the email is unknown, so "no such account" costs the same time as "wrong password". */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword(randomToken()));

/* ---------- UPI IDs: AES-256-GCM at rest, masked everywhere except the admin payout screen ---------- */

export function encryptUpi(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptUpi(key: Buffer, stored: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised UPI ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function maskUpi(upi: string): string {
  const [name = "", bank = ""] = upi.split("@");
  return `${name.slice(0, 3)}••@${bank}`;
}

export const UPI_PATTERN = /^[\w.-]{2,}@[a-zA-Z]{2,}$/;

/** "priya@gmail.com" -> "priya••@gmail.com" (matches the admin screens) */
export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 5)}••@${domain}`;
}
