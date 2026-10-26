const { execSync } = require("child_process");

const BASE = (process.env.NINE_ROUTER_URL || `http://127.0.0.1:${process.env.PORT || 20127}`).replace(/\/$/, "");
const headers = process.env.NINE_ROUTER_API_KEY ? { Authorization: `Bearer ${process.env.NINE_ROUTER_API_KEY}` } : {};

async function main() {
  console.log("9ROUTER STATUS (" + BASE + ")\n");
  console.log("Live quota & reset timers:  " + BASE + "/dashboard/quota");
  console.log("Token & usage stats:        " + BASE + "/dashboard/usage\n");

  try {
    const res = await fetch(`${BASE}/v1/models`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data = [] } = await res.json();
    const counts = {};
    for (const m of data) {
      const prefix = m.id.includes("/") ? m.id.split("/")[0] : "(alias/combo)";
      counts[prefix] = (counts[prefix] || 0) + 1;
    }
    console.log(`Models exposed by the gateway: ${data.length}`);
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(18)} ${v}`);
    }
  } catch (e) {
    console.log(`Gateway unreachable (${e.message}). Start it with start.cmd, or set NINE_ROUTER_URL / PORT.`);
  }

  try {
    console.log("\nKiro CLI accounts:\n" + execSync("kiro accounts", { encoding: "utf8", timeout: 5000 }).trim());
  } catch {
    console.log("\nKiro CLI check skipped (not installed or offline).");
  }
}

main();
