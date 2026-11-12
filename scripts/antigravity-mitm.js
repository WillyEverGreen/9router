#!/usr/bin/env node
/**
 * CLI bridge for 9Router's built-in Antigravity MITM manager API
 * (/api/cli-tools/antigravity-mitm).
 *
 * Usage:
 *   node scripts/antigravity-mitm.js start
 *   node scripts/antigravity-mitm.js stop
 *   node scripts/antigravity-mitm.js status
 */
const BASE_URL = (process.env.NINE_ROUTER_URL || `http://127.0.0.1:${process.env.PORT || 20127}`).replace(/\/$/, "");
const ENDPOINT = `${BASE_URL}/api/cli-tools/antigravity-mitm`;
const cmd = (process.argv[2] || "status").toLowerCase();

async function run() {
  if (!["start", "stop", "status"].includes(cmd)) {
    console.error("Usage: node scripts/antigravity-mitm.js <start|stop|status>");
    process.exit(2);
  }

  const { resolveRouterApiKey, resolveCliToken } = await import("./lib/routerEnv.mjs");
  const cliToken = resolveCliToken();
  const baseHeaders = { "Content-Type": "application/json" };
  if (cliToken) baseHeaders["x-9r-cli-token"] = cliToken;

  if (cmd === "status") {
    const res = await fetch(ENDPOINT, { headers: baseHeaders, signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (cmd === "start") {
    const apiKey = await resolveRouterApiKey();
    if (!apiKey) {
      throw new Error("No active 9Router API key found in env, SQLite DB, or ~/.claude/settings.json");
    }
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ apiKey }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    console.log(`[MITM] Started (running=${data.running}, pid=${data.pid ?? "-"})`);
    return;
  }

  const res = await fetch(ENDPOINT, {
    method: "DELETE",
    headers: baseHeaders,
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  console.log(`[MITM] Stopped (running=${data.running})`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[MITM] Error: ${err?.message || err}`);
    console.error(`Ensure 9Router is running at ${BASE_URL} (on Windows, MITM port 443 requires running 9Router elevated as Administrator).`);
    process.exit(1);
  });
}
