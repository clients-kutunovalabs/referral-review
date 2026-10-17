import { describe, expect, it } from "vitest";
import { createMockStorage } from "./index";

describe("mock storage", () => {
  it("stores an image and signs a url", async () => {
    const s = createMockStorage();
    const { key } = await s.put({ kind: "proof", contentType: "image/png", bytes: new Uint8Array(10) });
    expect(await s.signedUrl(key, 60)).toContain(key);
  });
  it("rejects wrong types and oversize files", async () => {
    const s = createMockStorage();
    await expect(s.put({ kind: "proof", contentType: "application/pdf", bytes: new Uint8Array(1) })).rejects.toThrow("JPG, PNG or WebP");
    await expect(s.put({ kind: "proof", contentType: "image/png", bytes: new Uint8Array(5 * 1024 * 1024 + 1) })).rejects.toThrow("5 MB");
  });
});
