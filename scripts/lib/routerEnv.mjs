import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Resolve 9Router runtime DATA_DIR matching the server convention
 * (`DATA_DIR` env -> `%APPDATA%\9router` on Windows -> `~/.9router` on POSIX).
 */
export function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(homedir(), "AppData", "Roaming");
    return path.join(appData, "9router");
  }
  return path.join(homedir(), ".9router");
}

/**
 * Derive the local CLI authentication token (`x-9r-cli-token`) for
 * local-only dashboard API routes when machine-id and auth/cli-secret exist.
 */
export function resolveCliToken() {
  const dataDir = resolveDataDir();
  const machinePath = path.join(dataDir, "machine-id");
  const secretPath = path.join(dataDir, "auth", "cli-secret");
  if (!existsSync(machinePath) || !existsSync(secretPath)) return "";
  const raw = readFileSync(machinePath, "utf8").trim();
  const secret = readFileSync(secretPath, "utf8").trim();
  if (!raw || !secret) return "";
  return crypto.createHash("sha256").update(`${raw}9r-cli-auth${secret}`).digest("hex").substring(0, 16);
}

/**
 * Read the first active 9Router API key from environment, local SQLite DB
 * (`db/data.sqlite`), or `~/.claude/settings.json`. Never creates or mutates DB.
 */
export async function resolveRouterApiKey(envNames = ["NINE_ROUTER_API_KEY", "OPENAI_API_KEY", "API_KEY"]) {
  for (const name of envNames) {
    const val = process.env[name]?.trim();
    if (val) return val;
  }

  const dbPath = path.join(resolveDataDir(), "db", "data.sqlite");
  if (existsSync(dbPath)) {
    let db = null;
    try {
      const { DatabaseSync } = await import("node:sqlite");
      db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db
        .prepare("SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt ASC LIMIT 1")
        .get();
      if (row?.key) return String(row.key).trim();
    } catch {
      // Fall through to Claude settings fallback if sqlite is unavailable or locked
    } finally {
      try {
        db?.close?.();
      } catch (err) {
        console.warn("[routerEnv] Failed to close SQLite handle:", err?.message || err);
      }
    }
  }

  try {
    const claudeSettings = JSON.parse(
      readFileSync(path.join(homedir(), ".claude", "settings.json"), "utf8")
    );
    const key = claudeSettings?.env?.ANTHROPIC_API_KEY || claudeSettings?.env?.OPENAI_API_KEY;
    if (key) return String(key).trim();
  } catch {
    // Ignore missing/unreadable Claude settings
  }

  return "";
}

