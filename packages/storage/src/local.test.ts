import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createLocalStorage } from "./local";

const dir = mkdtempSync(join(tmpdir(), "rr-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("local storage", () => {
  const s = createLocalStorage(dir);
  it("stores a file under a random name and reads it back with its type", async () => {
    const { key } = await s.put({ kind: "proof", contentType: "image/png", bytes: PNG });
    expect(key).toMatch(/^proof\/[0-9a-f-]{36}\.png$/);
    expect(await s.get(key)).toEqual({ bytes: PNG, contentType: "image/png" });
    expect(statSync(join(dir, key)).mode & 0o777).toBe(0o600);
  });
  it("never overwrites: every upload gets a new name", async () => {
    const a = await s.put({ kind: "proof", contentType: "image/png", bytes: PNG });
    const b = await s.put({ kind: "proof", contentType: "image/png", bytes: PNG });
    expect(a.key).not.toBe(b.key);
    expect(readdirSync(join(dir, "proof")).length).toBeGreaterThanOrEqual(2);
  });
  it("refuses keys that try to leave the folder", async () => {
    for (const k of ["../../etc/passwd", "proof/../../x.png", "/etc/passwd", "proof/abc.png", "proof/00000000-0000-0000-0000-000000000000.svg"]) {
      await expect(s.get(k)).rejects.toThrow(/Invalid file key/);
    }
  });
  it("rejects wrong types, oversize files and unknown kinds", async () => {
    await expect(s.put({ kind: "proof", contentType: "image/svg+xml", bytes: PNG })).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(s.put({ kind: "proof", contentType: "image/png", bytes: new Uint8Array(5 * 1024 * 1024 + 1) })).rejects.toThrow(/5 MB/);
    await expect(s.put({ kind: "evil" as never, contentType: "image/png", bytes: PNG })).rejects.toThrow(/Unknown upload type/);
  });
});
