// 9r zed-models: which Zed models each of your Zed accounts can use (live catalog + plan, tokens never printed).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dataDir = process.env.DATA_DIR || path.join(process.env.APPDATA || "", "9router");
const zed = await import(pathToFileURL(path.resolve(import.meta.dirname, "../open-sse/shared/zedAuth.js")).href);
const db = new DatabaseSync(path.join(dataDir, "db", "data.sqlite"), { readOnly: true });
const rows = db.prepare("select name,isActive,data from providerConnections where provider='zed' order by priority, createdAt").all();

const seen = [];
for (const r of rows) {
  const d = JSON.parse(r.data || "{}");
  const creds = { accessToken: d.accessToken, providerSpecificData: d.providerSpecificData || {}, connectionId: `zed-models-${r.name}` };
  console.log(`\n== ${r.name}${r.isActive ? "" : " (disabled)"}`);
  try {
    const me = await zed.fetchZedAuthenticatedUser(creds);
    const plan = me?.plan?.plan_v3 || me?.plan?.plan || me?.plan?.name || (typeof me?.plan === "string" ? me.plan : "") || "unknown";
    console.log(`   plan: ${plan}`);
  } catch (e) { console.log(`   plan: could not read (${e.message})`); }
  try {
    const cat = await zed.resolveZedModels(creds, { forceRefresh: true });
    const usable = cat.rawModels.filter((m) => !m.is_disabled).map((m) => m.id);
    const blocked = cat.rawModels.filter((m) => m.is_disabled).map((m) => `${m.id}${m.disabled_reason ? ` (${m.disabled_reason})` : ""}`);
    seen.push({ name: r.name, usable: new Set(usable) });
    console.log(`   usable (${usable.length}): ${usable.join(", ")}`);
    if (blocked.length) console.log(`   blocked (${blocked.length}): ${blocked.join(", ")}`);
  } catch (e) { console.log(`   catalog: failed (${e.message})`); }
}
if (seen.length > 1) {
  const all = [...new Set(seen.flatMap((s) => [...s.usable]))];
  const everywhere = all.filter((m) => seen.every((s) => s.usable.has(m)));
  console.log(`\nUsable on every Zed account: ${everywhere.join(", ") || "(none)"}`);
}
