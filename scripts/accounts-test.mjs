// 9r test: run the gateway's own per-account connection test (same call as dashboard "Test") for every account.
//   node scripts/accounts-test.mjs              all accounts
//   node scripts/accounts-test.mjs kiro         one provider
// Authenticates like the official 9router CLI (x-9r-cli-token derived from the local machine id + cli-secret).
// Read-only on local files; the gateway itself performs any token refresh. Env: NINE_ROUTER_URL / PORT, DATA_DIR.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
const BASE = (process.env.NINE_ROUTER_URL || `http://127.0.0.1:${process.env.PORT || 20127}`).replace(/\/$/, "");
const dataDir = process.env.DATA_DIR || (process.platform === "win32"
  ? path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), "9router")
  : path.join(homedir(), ".9router"));

const C = process.stdout.isTTY || process.env.FORCE_COLOR
  ? { g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" }
  : { g: "", y: "", r: "", d: "", b: "", x: "" };

function cliToken() {
  const read = (f) => { try { return readFileSync(path.join(dataDir, f), "utf8").trim(); } catch { return ""; } };
  const raw = read("machine-id");
  const secret = read(path.join("auth", "cli-secret"));
  if (!raw || !secret) throw new Error(`machine-id / auth/cli-secret not found under ${dataDir}`);
  return crypto.createHash("sha256").update(raw + "9r-cli-auth" + secret).digest("hex").substring(0, 16);
}

const dbFile = path.join(dataDir, "db", "data.sqlite");
if (!existsSync(dbFile)) { console.error(`Database not found: ${dbFile}`); process.exit(1); }
const db = new DatabaseSync(dbFile, { readOnly: true });
const rows = db.prepare("select id,provider,name,email,isActive from providerConnections order by provider, priority, name").all()
  .filter((r) => !only || r.provider === only);

const headers = { "x-9r-cli-token": cliToken(), "content-type": "application/json" };
console.log(`${C.b}9ROUTER PER-ACCOUNT TEST${C.x} ${C.d}${BASE} - ${rows.length} accounts, one at a time${C.x}\n`);

let cur = "", ok = 0, bad = 0, off = 0;
const failures = [];
for (const r of rows) {
  if (r.provider !== cur) { cur = r.provider; console.log(`${C.b}${cur}${C.x}`); }
  const label = (r.name || r.email || r.id.slice(0, 8)).slice(0, 40).padEnd(40);
  if (!r.isActive) { off++; console.log(`  ${C.d}SKIP  ${label} disabled${C.x}`); continue; }
  const t = Date.now();
  try {
    const res = await fetch(`${BASE}/api/providers/${encodeURIComponent(r.id)}/test`, { method: "POST", headers, signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    let j = {}; try { j = JSON.parse(text); } catch { /* non-JSON */ }
    const ms = `${Date.now() - t}ms`;
    if (res.status === 401 || res.status === 403) { console.log(`  ${C.r}AUTH  ${C.x}${label} gateway rejected the CLI token (HTTP ${res.status})`); bad++; continue; }
    if (j.valid) { ok++; console.log(`  ${C.g}PASS  ${C.x}${label} ${C.d}${ms}${j.refreshed ? " (token refreshed)" : ""}${C.x}`); }
    else {
      bad++;
      const err = String(j.error || text).replace(/\s+/g, " ").slice(0, 110);
      failures.push({ provider: r.provider, name: r.name || r.email, err });
      console.log(`  ${C.r}FAIL  ${C.x}${label} ${C.d}${ms}${C.x} ${err}`);
    }
  } catch (e) { bad++; failures.push({ provider: r.provider, name: r.name, err: e.message }); console.log(`  ${C.r}FAIL  ${C.x}${label} ${e.message}`); }
}
console.log(`\n${C.b}Result:${C.x} ${C.g}${ok} pass${C.x}, ${bad ? C.r : C.d}${bad} fail${C.x}${off ? `, ${off} disabled` : ""}`);
