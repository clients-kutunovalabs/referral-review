import type { AiPort, EmailSenderPort, StoragePort } from "@rr/core";
import type { Db } from "@rr/db";

export interface ServerConfig {
  workspaceId: string;
  /** 32 bytes. Encrypts UPI IDs at rest. */
  upiKey: Buffer;
  /** Signs CSRF tokens and peppers one-time-code hashes. At least 32 characters. */
  secret: string;
  /** Public origin of the site, e.g. https://tasks.example.com. Mutating requests must come from it. */
  baseUrl: string;
  /** Number of trusted reverse proxies in front of the app (0 = ignore X-Forwarded-For). */
  trustProxyHops: number;
  sessionDays: number;
  maxIdentitiesPerUser: number;
  /** Whether an AI provider is configured. Without it, admins cannot publish AI-script tasks. */
  aiEnabled: boolean;
}

export interface Ctx {
  db: Db;
  cfg: ServerConfig;
  storage: StoragePort;
  ai: AiPort;
  email: EmailSenderPort;
  /** The one place "now" comes from, so tests can move time. */
  now: () => Date;
}

export const secureCookies = (cfg: ServerConfig): boolean => cfg.baseUrl.startsWith("https://");
