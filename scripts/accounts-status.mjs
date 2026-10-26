// 9r accounts: per-provider / per-account health from the gateway's own database.
//   node scripts/accounts-status.mjs            state recorded by the gateway (read-only, no secrets printed)
//   node scripts/accounts-status.mjs --live     also send one tiny request per provider through the gateway
//   node scripts/accounts-status.mjs kiro       only that provider
// Env: NINE_ROUTER_URL / PORT (default 20127), NINE_ROUTER_API_KEY (or ANTHROPIC_API_KEY from ~/.claude/settings.json) for --live,
//      DATA_DIR to point at a non-default database.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const live = args.includes("--live");
const only = args.find((a) => !a.startsWith("--"));
const BASE = (process.env.NINE_ROUTER_URL || `http://127.0.0.1:${process.env.PORT || 20127}`).replace(/\/$/, "");

const C = process.stdout.isTTY || process.env.FORCE_COLOR
  ? { g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" }
  : { g: "", y: "", r: "", d: "", b: "", x: "" };

function dbPath() {
  const candidates = [
    process.env.DATA_DIR && path.join(process.env.DATA_DIR, "db", "data.sqlite"),
    process.env.APPDATA && path.join(process.env.APPDATA, "9router", "db", "data.sqlite"),
    path.join(homedir(), ".9router", "db", "data.sqlite"),
  ].filter(Boolean);
  // Several locations can exist; the live one is the most recently written.
  const found = candidates.filter(existsSync);
  const newest = (p) => { try { return Math.max(...["", "-wal"].map((s) => { try { return statSync(p + s).mtimeMs; } catch { return 0; } })); } catch { return 0; } };
  return found.sort((a, b) => newest(b) - newest(a))[0];
}

function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function inFuture(iso) { const t = Date.parse(iso); return t && t > Date.now() ? t : 0; }
function until(t) {
  const m = Math.round((t - Date.now()) / 60000);
  return m < 90 ? `${m}m` : m < 2160 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

function classify(row, d) {
  if (!row.isActive) return { tag: "DISABLED", color: C.d, note: "turned off in dashboard" };
  const rl = inFuture(d.rateLimitedUntil);
  if (rl) return { tag: "RATE-LIMITED", color: C.y, note: `back in ${until(rl)}` };
  const locks = Object.entries(d).filter(([k, v]) => k.startsWith("modelLock_") && inFuture(v));
  const lockedModels = locks.map(([k]) => k.slice("modelLock_".length));
  const st = d.testStatus;
  if (st === "active" || st === "success" || !st) {
    return lockedModels.length
      ? { tag: "OK*", color: C.y, note: `${lockedModels.length} model(s) cooling down: ${lockedModels.slice(0, 3).join(", ")}${lockedModels.length > 3 ? "…" : ""}` }
      : { tag: "OK", color: C.g, note: "" };
  }
  const err = String(d.lastError || "").replace(/\s+/g, " ").slice(0, 70);
  const when = d.lastErrorAt ? ` (${ago(d.lastErrorAt)})` : "";
  const net = /ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|EAI_AGAIN/i.test(err);
  const auth = /401|403|expired|revoked|invalid_grant|unauthor/i.test(err);
  if (auth) return { tag: "RE-LOGIN", color: C.r, note: `${err}${when}` };
  return { tag: net ? "NETWORK?" : "ERROR", color: C.r, note: `${err}${when}${net ? " – transient, probably recovers on next use" : ""}` };
}

const file = dbPath();
if (!file) { console.error("Gateway database not found. Set DATA_DIR."); process.exit(1); }
const db = new DatabaseSync(file, { readOnly: true });
const rows = db.prepare("select id,provider,authType,name,email,priority,isActive,data from providerConnections order by provider, priority, name").all();

const byProvider = new Map();
for (const r of rows) {
  if (only && r.provider !== only) continue;
  const d = (() => { try { return JSON.parse(r.data || "{}"); } catch { return {}; } })();
  if (!byProvider.has(r.provider)) byProvider.set(r.provider, []);
  byProvider.get(r.provider).push({ r, d, s: classify(r, d) });
}

console.log(`${C.b}9ROUTER ACCOUNTS${C.x}  ${C.d}${BASE}  db: ${file}${C.x}\n`);
let total = 0, okCount = 0;
for (const [prov, list] of byProvider) {
  const ok = list.filter((x) => x.s.tag.startsWith("OK")).length;
  total += list.length; okCount += ok;
  const head = ok === list.length ? C.g : ok === 0 ? C.r : C.y;
  console.log(`${C.b}${prov}${C.x}  ${head}${ok}/${list.length} usable${C.x}`);
  for (const { r, d, s } of list) {
    const name = (r.name || r.email || r.id.slice(0, 8)).slice(0, 38).padEnd(38);
    const auth = r.authType === "oauth" ? "oauth" : r.authType === "apikey" ? "key  " : String(r.authType).slice(0, 5).padEnd(5);
    const exp = d.expiresAt && r.authType === "oauth" ? `${C.d} token ${Date.parse(d.expiresAt) > Date.now() ? "valid " + until(Date.parse(d.expiresAt)) : "refreshes on use"}${C.x}` : "";
    console.log(`  ${s.color}${s.tag.padEnd(12)}${C.x} ${name} ${C.d}${auth}${C.x}${exp}${s.note ? "  " + s.color + s.note + C.x : ""}`);
  }
  console.log("");
}
console.log(`${C.b}Total:${C.x} ${okCount}/${total} accounts usable\n`);

if (live) {
  let key = process.env.NINE_ROUTER_API_KEY;
  if (!key) { try { key = JSON.parse(readFileSync(path.join(homedir(), ".claude", "settings.json"), "utf8")).env?.ANTHROPIC_API_KEY; } catch { /* none */ } }
  const headers = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
  console.log(`${C.b}LIVE PROBE${C.x} ${C.d}(one tiny request per provider through the gateway; the gateway picks the account)${C.x}`);
  let models = [];
  try { models = (await (await fetch(`${BASE}/v1/models`, { headers })).json()).data.map((m) => m.id); }
  catch (e) { console.log(`${C.r}Gateway unreachable: ${e.message}${C.x}`); process.exit(1); }
  const PREFIX = { zed: "zd", kiro: "kr", codex: "cx", antigravity: "ag", claude: "cc", gemini: "gc", github: "gh", openai: "openai" };
  const PREFER = /haiku|flash|mini|nano|luna|deepseek|3\.5|4\.5/i;
  for (const prov of byProvider.keys()) {
    const pre = (PREFIX[prov] || prov) + "/";
    const cands = models.filter((m) => m.startsWith(pre) && !/image|embed|tts|transcribe|review|\[1m\]/i.test(m));
    const ranked = [...cands.filter((m) => PREFER.test(m)), ...cands.filter((m) => !PREFER.test(m))].slice(0, 3);
    if (!ranked.length) { console.log(`  ${C.d}${prov.padEnd(12)} no chat model exposed${C.x}`); continue; }
    let last = "";
    let passed = false;
    for (const model of ranked) {
      const t = Date.now();
      try {
        const res = await fetch(`${BASE}/v1/chat/completions`, { method: "POST", headers, signal: AbortSignal.timeout(45000),
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with: pong" }], max_tokens: 20, stream: false }) });
        const body = await res.text();
        if (res.ok) { console.log(`  ${C.g}OK     ${C.x} ${prov.padEnd(12)} ${model.padEnd(32)} ${Date.now() - t}ms`); passed = true; break; }
        last = `${model} -> ${res.status} ${body.replace(/\s+/g, " ").slice(0, 100)}`;
      } catch (e) { last = `${model} -> ${e.message}`; }
    }
    if (!passed) console.log(`  ${C.r}FAIL   ${C.x} ${prov.padEnd(12)} (tried ${ranked.length}) ${last}`);
  }
  console.log(`\n${C.d}Per-account live test: dashboard → Providers → Test all (needs your login).${C.x}`);
}
