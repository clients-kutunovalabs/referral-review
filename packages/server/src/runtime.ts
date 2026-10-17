import { aiNotConfigured, createAnthropicAi } from "@rr/ai";
import { createConsoleSender, createSmtpSender } from "@rr/auth/email";
import { loadConfig, type AppConfig } from "@rr/config";
import { createPgDb, createPgliteDb, migrate, type Db } from "@rr/db";
import { createLocalStorage } from "@rr/storage/local";
import type { Ctx } from "./ctx";
import { seedOwner } from "./seed";

export interface Runtime { ctx: Ctx; cfg: AppConfig; db: Db; close(): Promise<void> }

/** Builds the real thing from the environment: database, file storage, email, AI. The web app and the worker both start here. */
export async function createRuntime(cfg: AppConfig = loadConfig()): Promise<Runtime> {
  const db = cfg.databaseUrl ? createPgDb({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl }) : await createPgliteDb(cfg.pgliteDir);
  const ctx: Ctx = {
    db,
    cfg: {
      workspaceId: cfg.workspaceId, upiKey: cfg.upiKey, secret: cfg.secret, baseUrl: cfg.appUrl, trustProxyHops: cfg.trustProxyHops,
      sessionIdleHours: cfg.sessionIdleHours, maxIdentitiesPerUser: cfg.maxIdentitiesPerUser, aiEnabled: !!cfg.anthropicApiKey
    },
    storage: createLocalStorage(cfg.uploadDir),
    ai: cfg.anthropicApiKey ? createAnthropicAi({ apiKey: cfg.anthropicApiKey, model: cfg.aiModel }) : aiNotConfigured,
    email: cfg.emailMode === "smtp" ? createSmtpSender(cfg.smtpUrl as string, cfg.mailFrom) : createConsoleSender(),
    now: () => new Date()
  };
  return { ctx, cfg, db, close: () => db.close() };
}

/** Applies migrations (when AUTO_MIGRATE is on) and makes sure the owner exists (when OWNER_EMAIL is set). Idempotent. */
export async function prepare(rt: Runtime): Promise<string[]> {
  const applied = rt.cfg.autoMigrate ? await migrate(rt.db) : [];
  if (rt.cfg.owner) await seedOwner(rt.ctx, rt.cfg.owner);
  return applied;
}
