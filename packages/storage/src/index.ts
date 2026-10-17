import { UPLOAD_RULES, type StoragePort } from "@rr/core";

/** In-memory bucket for ui-hub and tests. Applies the same type and size rules the real server must. */
export function createMockStorage(): StoragePort {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  let seq = 0;
  return {
    async put({ kind, contentType, bytes }) {
      if (!UPLOAD_RULES.contentTypes.includes(contentType)) throw new Error("Use a JPG, PNG or WebP image.");
      if (bytes.byteLength > UPLOAD_RULES.maxBytes) throw new Error("Image must be under 5 MB.");
      const key = `${kind}/${++seq}`;
      files.set(key, { bytes, contentType });
      return { key };
    },
    async get(key) {
      const f = files.get(key);
      if (!f) throw new Error("File not found.");
      return f;
    },
    async signedUrl(key, ttlSeconds) {
      if (!files.has(key)) throw new Error("File not found.");
      return `mock://${key}?expires=${ttlSeconds}`;
    }
  };
}

/** Placeholder for the real object-storage adapter (S3-compatible: private bucket, separate upload domain, short-lived signed URLs). */
export function createObjectStorage(config: { endpoint: string }): StoragePort {
  const unavailable = async (): Promise<never> => { throw new Error(`Object storage is not connected yet (${config.endpoint || "no OBJECT_STORAGE_ENDPOINT"}).`); };
  return { put: unavailable, get: unavailable, signedUrl: unavailable };
}
