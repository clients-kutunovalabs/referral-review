import { UPLOAD_RULES, type UploadKind } from "@rr/core";
import type { Ctx } from "./ctx";
import { fail, forbidden, notFound } from "./errors";
import type { AdminActor } from "./rbac";

/** The file's real type from its first bytes. The type the browser claims is never trusted. */
export function sniffImage(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (i: number) => b[i] ?? -1;
  if (b.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "image/png";
  if (b.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (b.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  return null;
}

export async function saveUpload(ctx: Ctx, userId: string, kind: UploadKind, bytes: Uint8Array): Promise<{ fileId: string }> {
  if (bytes.byteLength === 0) fail("upload_invalid", "That file is empty.");
  if (bytes.byteLength > UPLOAD_RULES.maxBytes) fail("upload_invalid", "Image must be under 5 MB.");
  const type = sniffImage(bytes);
  if (!type) return fail("upload_invalid", "Use a JPG, PNG or WebP image.");
  const { key } = await ctx.storage.put({ kind, contentType: type, bytes });
  const [f] = await ctx.db.query<{ id: string }>(
    "insert into files (workspace_id, owner_user_id, kind, storage_key, content_type, size_bytes, created_at) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [ctx.cfg.workspaceId, userId, kind, key, type, bytes.byteLength, ctx.now()]);
  return { fileId: f!.id };
}

const ADMIN_FOR: Record<UploadKind, "review.decide" | "payout.mark_paid" | "ticket.manage"> = {
  proof: "review.decide", payment_proof: "payout.mark_paid", ticket_attachment: "ticket.manage"
};

/** Who may upload which kind: workers send proofs and ticket images; only a payer attaches payment proof. */
export function mayUpload(kind: UploadKind, admin: AdminActor | null): boolean {
  if (kind === "payment_proof") return !!admin?.permissions.has("payout.mark_paid");
  return true;
}

/** A file is readable by its owner, or by an admin whose permission covers that kind of file. */
export async function readFile(ctx: Ctx, fileId: string, viewerId: string, admin: AdminActor | null): Promise<{ bytes: Uint8Array; contentType: string }> {
  const [f] = await ctx.db.query<{ owner_user_id: string; kind: UploadKind; storage_key: string; content_type: string }>(
    "select owner_user_id, kind, storage_key, content_type from files where id = $1 and workspace_id = $2", [fileId, ctx.cfg.workspaceId]);
  if (!f) return notFound("File");
  const allowed = f.owner_user_id === viewerId || !!admin?.permissions.has(ADMIN_FOR[f.kind]);
  if (!allowed) return forbidden();
  const { bytes } = await ctx.storage.get(f.storage_key);
  return { bytes, contentType: f.content_type };
}

export const fileUrl = (id: string | null | undefined): string | undefined => (id ? `/api/files/${id}` : undefined);
