import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./index";

const prod = { NODE_ENV: "production", APP_URL: "https://tasks.example.com", DATABASE_URL: "postgres://u:p@h/db", SESSION_SECRET: "x".repeat(40), UPI_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), SMTP_URL: "smtps://u:p@smtp.example.com:465" };
const problems = (env: Record<string, string>) => { try { loadConfig(env); return []; } catch (e) { return (e as ConfigError).problems; } };

describe("loadConfig", () => {
  it("never allows the one-click dev sign-in in production, and it is off by default", () => {
    expect(loadConfig({}).devLogin).toBe(false);
    expect(loadConfig({ DEV_LOGIN: "1" }).devLogin).toBe(true);
    expect(problems({ ...prod, DEV_LOGIN: "1" }).join(" ")).toContain("DEV_LOGIN");
    expect(problems({ ...prod, NODE_ENV: "development", APP_ENV: "production", DEV_LOGIN: "true" }).join(" ")).toContain("DEV_LOGIN");
  });

  it("runs in development with nothing set", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ production: false, appUrl: "http://localhost:3000", emailMode: "console", autoMigrate: true, trustProxyHops: 1 });
    expect(c.upiKey).toHaveLength(32);
    expect(c.databaseUrl).toBeUndefined();
  });
  it("accepts a complete production environment", () => {
    expect(loadConfig(prod)).toMatchObject({ production: true, emailMode: "smtp", appUrl: "https://tasks.example.com" });
  });
  it("refuses to start in production without real secrets, a database, https or a mail server", () => {
    expect(problems({ NODE_ENV: "production" }).join("\n")).toMatch(/SESSION_SECRET[\s\S]*UPI_ENCRYPTION_KEY[\s\S]*DATABASE_URL[\s\S]*https[\s\S]*SMTP_URL/);
  });
  it("refuses console email in production", () => {
    expect(problems({ ...prod, EMAIL_MODE: "console" }).join()).toContain("logs");
  });
  it("validates key length and owner pair", () => {
    expect(problems({ ...prod, UPI_ENCRYPTION_KEY: "dG9vc2hvcnQ=" }).join()).toContain("32 bytes");
    expect(problems({ OWNER_EMAIL: "a@b.co" }).join()).toContain("OWNER_EMAIL and OWNER_PASSWORD");
    expect(problems({ SESSION_SECRET: "short" }).join()).toContain("at least 32");
  });
  it("APP_ENV overrides NODE_ENV, so a production build can be tried locally", () => {
    expect(loadConfig({ NODE_ENV: "production", APP_ENV: "development" })).toMatchObject({ production: false, emailMode: "console" });
    expect(problems({ NODE_ENV: "development", APP_ENV: "production" }).length).toBeGreaterThan(0);
  });
  it("treats empty strings as unset and parses booleans and numbers", () => {
    expect(loadConfig({ DATABASE_URL: "", AUTO_MIGRATE: "0", SESSION_IDLE_HOURS: "72", TRUST_PROXY_HOPS: "2" })).toMatchObject({ databaseUrl: undefined, autoMigrate: false, sessionIdleHours: 72, trustProxyHops: 2 });
  });
});
