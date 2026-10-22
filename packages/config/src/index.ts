import { z } from "zod";

const bool = (def: boolean) => z.enum(["0", "1", "true", "false"]).optional().transform((v) => (v === undefined ? def : v === "1" || v === "true"));
const int = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);

/** Dev-only fallbacks so `pnpm dev:web` runs with no .env. Production refuses to start without real values. */
const DEV_SECRET = "dev-only-secret-change-me-dev-only-secret-change-me";
const DEV_UPI_KEY = Buffer.alloc(32, 42).toString("base64");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * APP_ENV=development lets a production build run locally over plain http with test email. It relaxes only that: a
   * production build (NODE_ENV=production) always needs real secrets and a real database, and never allows DEV_LOGIN.
   */
  APP_ENV: z.enum(["development", "test", "production"]).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  WORKSPACE_ID: z.string().uuid().default("00000000-0000-0000-0000-000000000001"),

  /** PostgreSQL (Vista). Without it the app uses PGlite in PGLITE_DIR, which is for local development only. */
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: bool(false),
  PGLITE_DIR: z.string().default(".data/pglite"),
  AUTO_MIGRATE: bool(true),
  ALERT_WEBHOOK_URL: z.string().url().optional(), // where to post alerts (Slack, Discord, any JSON webhook); off when empty
  DEV_LOGIN: bool(false), // development only (NODE_ENV=development, i.e. `next dev`): one-click sign-in as a demo worker or admin.

  SESSION_SECRET: z.string().optional(),
  UPI_ENCRYPTION_KEY: z.string().optional(),
  SESSION_IDLE_HOURS: int(168, 1, 2160), // a session ends after this long without a visit; every visit restarts the count
  MAX_IDENTITIES_PER_USER: int(10, 1, 50),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(), // required in production; 1 elsewhere

  UPLOAD_DIR: z.string().default(".data/uploads"),

  EMAIL_MODE: z.enum(["smtp", "console"]).optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Task board <no-reply@localhost>"),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(), // AI scripts are off unless both ANTHROPIC_API_KEY and AI_MODEL are set

  OWNER_EMAIL: z.string().email().optional(),
  OWNER_NAME: z.string().default("Owner"),
  OWNER_PASSWORD: z.string().min(8).optional()
});

export interface AppConfig {
  env: "development" | "test" | "production";
  production: boolean;
  appUrl: string;
  workspaceId: string;
  databaseUrl: string | undefined;
  databaseSsl: boolean;
  pgliteDir: string;
  autoMigrate: boolean;
  devLogin: boolean;
  alertWebhookUrl: string | undefined;
  secret: string;
  upiKey: Buffer;
  sessionIdleHours: number;
  maxIdentitiesPerUser: number;
  trustProxyHops: number;
  uploadDir: string;
  emailMode: "smtp" | "console";
  smtpUrl: string | undefined;
  mailFrom: string;
  anthropicApiKey: string | undefined;
  aiModel: string | undefined;
  owner: { email: string; name: string; password: string } | undefined;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Configuration problems:\n - ${problems.join("\n - ")}`);
    this.name = "ConfigError";
  }
}

/** Reads and checks the environment once, with clear errors. In production every secret must be set explicitly. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === "" ? undefined : v])));
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const e = parsed.data;
  const production = (e.APP_ENV ?? e.NODE_ENV) === "production";
  // A production build is held to the safety rules whatever APP_ENV says.
  const strict = production || e.NODE_ENV === "production";
  const problems: string[] = [];

  if (strict && !e.SESSION_SECRET) problems.push("SESSION_SECRET is required in production (at least 32 random characters).");
  if (e.SESSION_SECRET && e.SESSION_SECRET.length < 32) problems.push("SESSION_SECRET must be at least 32 characters.");
  if (strict && !e.UPI_ENCRYPTION_KEY) problems.push("UPI_ENCRYPTION_KEY is required in production (32 bytes, base64).");
  const upiKey = Buffer.from(e.UPI_ENCRYPTION_KEY ?? DEV_UPI_KEY, "base64");
  if (upiKey.length !== 32) problems.push("UPI_ENCRYPTION_KEY must decode to exactly 32 bytes (try: openssl rand -base64 32).");
  if (strict && !e.DATABASE_URL) problems.push("DATABASE_URL is required in production. PGlite is for local development only.");
  if (production && !e.APP_URL.startsWith("https://")) problems.push("APP_URL must be https:// in production (cookies are Secure).");
  const emailMode = e.EMAIL_MODE ?? (production ? "smtp" : "console");
  if (production && emailMode === "console") problems.push("EMAIL_MODE=console would print sign-in codes into the logs. Use smtp in production.");
  if (emailMode === "smtp" && !e.SMTP_URL) problems.push("SMTP_URL is required when EMAIL_MODE=smtp (e.g. smtps://user:pass@smtp.example.com:465).");
  if ((e.OWNER_EMAIL && !e.OWNER_PASSWORD) || (!e.OWNER_EMAIL && e.OWNER_PASSWORD)) problems.push("Set both OWNER_EMAIL and OWNER_PASSWORD, or neither.");
  if (e.DEV_LOGIN && (strict || e.NODE_ENV !== "development")) problems.push("DEV_LOGIN would let anyone sign in without a password. It works only in development (npm run dev), never in a built site.");
  if (production && e.TRUST_PROXY_HOPS === undefined) problems.push("TRUST_PROXY_HOPS is required in production: the number of reverse proxies in front of the site (0 if none). It decides which address rate limits count.");
  if (e.ANTHROPIC_API_KEY && !e.AI_MODEL) problems.push("AI_MODEL is required when ANTHROPIC_API_KEY is set (the exact model id to write scripts with).");
  if (problems.length) throw new ConfigError(problems);

  return {
    env: e.APP_ENV ?? e.NODE_ENV, production, appUrl: e.APP_URL.replace(/\/$/, ""), workspaceId: e.WORKSPACE_ID,
    databaseUrl: e.DATABASE_URL, databaseSsl: e.DATABASE_SSL, pgliteDir: e.PGLITE_DIR, autoMigrate: e.AUTO_MIGRATE, devLogin: e.DEV_LOGIN, alertWebhookUrl: e.ALERT_WEBHOOK_URL,
    secret: e.SESSION_SECRET ?? DEV_SECRET, upiKey, sessionIdleHours: e.SESSION_IDLE_HOURS, maxIdentitiesPerUser: e.MAX_IDENTITIES_PER_USER, trustProxyHops: e.TRUST_PROXY_HOPS ?? 1,
    uploadDir: e.UPLOAD_DIR, emailMode, smtpUrl: e.SMTP_URL, mailFrom: e.MAIL_FROM,
    anthropicApiKey: e.ANTHROPIC_API_KEY, aiModel: e.AI_MODEL,
    owner: e.OWNER_EMAIL && e.OWNER_PASSWORD ? { email: e.OWNER_EMAIL, name: e.OWNER_NAME, password: e.OWNER_PASSWORD } : undefined
  };
}
