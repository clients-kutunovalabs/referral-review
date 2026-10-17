import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { UPLOAD_RULES, type StoragePort, type UploadKind } from "@rr/core";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const KEY = /^(proof|payment_proof|ticket_attachment)\/[0-9a-f-]{36}\.(png|jpg|webp)$/;
const KINDS: readonly UploadKind[] = ["proof", "payment_proof", "ticket_attachment"];

/**
 * Files on this server's disk, under `dir` (mount a persistent volume there). Names are random, nothing user-controlled reaches
 * the path, and files are only ever served through the authorised /api/files route, never straight from disk.
 * For several app servers, replace this with an S3-compatible adapter behind the same StoragePort.
 */
export function createLocalStorage(dir: string): StoragePort {
  const root = resolve(dir);
  const pathOf = (key: string): string => {
    if (!KEY.test(key)) throw new Error("Invalid file key.");
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error("Invalid file key.");
    return full;
  };
  return {
    async put({ kind, contentType, bytes }) {
      if (!KINDS.includes(kind)) throw new Error("Unknown upload type.");
      const ext = EXT[contentType];
      if (!ext || !UPLOAD_RULES.contentTypes.includes(contentType)) throw new Error("Use a JPG, PNG or WebP image.");
      if (bytes.byteLength > UPLOAD_RULES.maxBytes) throw new Error("Image must be under 5 MB.");
      const key = `${kind}/${randomUUID()}.${ext}`;
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      return { key };
    },
    async get(key) {
      const bytes = await readFile(pathOf(key));
      return { bytes: new Uint8Array(bytes), contentType: TYPE[key.split(".").pop() as string] as string };
    },
    async signedUrl() { throw new Error("The local store has no signed URLs: files are served through /api/files after an access check."); }
  };
}

