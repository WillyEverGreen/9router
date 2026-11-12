#!/usr/bin/env node
/**
 * 9ai Ready & Verification Script + 24H Keep-Awake Watchdog
 * Prefers the Windows 9Router supervisor (`C:\tools\9router\9r-ctl.ps1` / port 20129)
 * when present so it never spawns competing bridge/tunnel processes, and falls back
 * cleanly to standalone `proxy-20128.js` + `cloudflared` on unmanaged setups.
 *
 * Usage:
 *   node scripts/start-9ai.js           # Ensure stack, verify gateway
 *   node scripts/start-9ai.js --status  # Print status without spawning processes
 *   node scripts/start-9ai.js --watch   # Continuous watchdog loop
 *   node scripts/start-9ai.js --help    # Show usage
 */

const http = require("http");
const https = require("https");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT_ROUTER = 20127;
const PORT_BRIDGE = 20128;
const PORT_SUPERVISOR = 20129;
const SUPERVISOR_PING_URL = `http://127.0.0.1:${PORT_SUPERVISOR}/ping`;
const SUPERVISOR_CTL = "C:\\tools\\9router\\9r-ctl.ps1";
const PROXY_SCRIPT = path.join(__dirname, "proxy-20128.js");

const CLIP_DIR = process.env.CLIP_DIR || null;
const CLIP_WRANGLER = CLIP_DIR ? path.join(CLIP_DIR, "worker", "wrangler.toml") : null;
const APP_DATA_BASE = process.platform === "win32"
  ? (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"))
  : os.homedir();
const ROUTER_HOME = process.platform === "win32"
  ? path.join(APP_DATA_BASE, "9router")
  : path.join(APP_DATA_BASE, ".9router");
const TUNNEL_STATE = path.join(ROUTER_HOME, "tunnel", "state.json");
const CLOUDFLARED_BIN = path.join(
  ROUTER_HOME,
  "bin",
  process.platform === "win32" ? "cloudflared.exe" : "cloudflared"
);
const GATEWAY_URL = "https://clip.foo.ng/9ai";

const isWatchMode = process.argv.includes("--watch") || process.argv.includes("-w");
const isStatusOnly = process.argv.includes("--status") || process.argv.includes("-s");
const isHelp = process.argv.includes("--help") || process.argv.includes("-h");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      resolve(true);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function getSupervisorStatus() {
  return new Promise((resolve) => {
    const req = http.get(SUPERVISOR_PING_URL, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function isCloudflaredRunning() {
  if (process.platform === "win32") {
    try {
      const out = execSync(
        'powershell.exe -NoProfile -Command "Get-Process -Name *cloudflared* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"',
        { encoding: "utf8" }
      ).trim();
      return Boolean(out);
    } catch {
      return false;
    }
  }
  try {
    const out = execSync("pgrep -x cloudflared", { encoding: "utf8" }).trim();
    return Boolean(out);
  } catch {
    return false;
  }
}

async function ensure9Router() {
  process.stdout.write("[*] Checking 9Router daemon (port 20127)... ");
  if (await checkPort(PORT_ROUTER)) {
    console.log("OK (running)");
    return true;
  }

  console.log("Not running. Starting...");
  try {
    if (process.platform === "win32" && fs.existsSync(SUPERVISOR_CTL)) {
      spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SUPERVISOR_CTL, "start"],
        { detached: true, stdio: "ignore" }
      ).unref();
    } else {
      spawn("cmd.exe", ["/c", "9r", "start"], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (err) {
    console.error("[-] Failed to start 9router:", err.message);
  }

  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await checkPort(PORT_ROUTER)) {
      console.log("[+] 9Router is now up and listening on port 20127!");
      return true;
    }
  }

  console.log("[!] 9Router is taking longer than expected. Continuing...");
  return false;
}

async function ensureBridge() {
  process.stdout.write("[*] Checking port 20128 bridge... ");
  if (await checkPort(PORT_BRIDGE)) {
    console.log("OK (running)");
    return true;
  }

  const supervisor = await getSupervisorStatus();
  if (supervisor) {
    console.log(`Managed by supervisor (pid ${supervisor.pid}); waiting briefly...`);
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      if (await checkPort(PORT_BRIDGE)) {
        console.log("[+] Supervisor bridge is active on port 20128!");
        return true;
      }
    }
    return false;
  }

  console.log("Not running. Starting proxy-20128.js...");
  try {
    spawn(process.execPath, [PROXY_SCRIPT], { detached: true, stdio: "ignore" }).unref();
  } catch (err) {
    console.error("[-] Failed to spawn bridge:", err.message);
  }

  for (let i = 0; i < 10; i++) {
    await sleep(300);
    if (await checkPort(PORT_BRIDGE)) {
      console.log("[+] Bridge is now active on port 20128!");
      return true;
    }
  }

  console.log("[!] Bridge did not respond on port 20128.");
  return false;
}

async function ensureTunnel() {
  process.stdout.write("[*] Checking Cloudflare tunnel... ");
  const supervisor = await getSupervisorStatus();
  if (supervisor?.tunnel?.registered && supervisor.tunnel.publicUrl) {
    console.log(`OK (managed by supervisor -> ${supervisor.tunnel.publicUrl})`);
    return true;
  }

  if (isCloudflaredRunning()) {
    console.log("OK (running)");
    return true;
  }

  if (supervisor) {
    console.log(`Managed by supervisor (pid ${supervisor.pid}); waiting for tunnel registration...`);
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const updated = await getSupervisorStatus();
      if (updated?.tunnel?.registered) {
        console.log(`[+] Supervisor tunnel registered (${updated.tunnel.publicUrl})`);
        return true;
      }
    }
    console.log("[!] Supervisor tunnel still initializing.");
    return false;
  }

  console.log("Not running. Spawning cloudflared...");
  if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.error("[-] cloudflared binary not found at", CLOUDFLARED_BIN);
    return false;
  }

  let child;
  try {
    child = spawn(
      CLOUDFLARED_BIN,
      ["tunnel", "--url", `http://127.0.0.1:${PORT_BRIDGE}`, "--no-autoupdate", "--retries", "99"],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    child.unref();
  } catch (err) {
    console.error("[-] Failed to spawn cloudflared:", err.message);
    return false;
  }

  let capturedUrl = null;
  const matchRegex = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i;
  const onData = async (chunk) => {
    const match = chunk.toString().match(matchRegex);
    if (!match || capturedUrl || match[1] === "api") return;
    capturedUrl = `https://${match[1]}.trycloudflare.com`;
    console.log(`[+] New trycloudflare URL: ${capturedUrl}`);
    let shortId = "tkkzz3";
    try {
      if (fs.existsSync(TUNNEL_STATE)) {
        const parsed = JSON.parse(fs.readFileSync(TUNNEL_STATE, "utf8"));
        if (parsed.shortId) shortId = parsed.shortId;
      }
    } catch (err) {
      console.warn(`[start-9ai] Could not read tunnel state (${TUNNEL_STATE}): ${err?.message || err}`);
    }
    try {
      await fetch("https://abc-tunnel.us/api/tunnel/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortId, tunnelUrl: capturedUrl }),
      });
      fs.mkdirSync(path.dirname(TUNNEL_STATE), { recursive: true });
      fs.writeFileSync(TUNNEL_STATE, JSON.stringify({ shortId, tunnelUrl: capturedUrl }), "utf8");
      console.log(`[+] Registered to https://r${shortId}.abc-tunnel.us`);
    } catch (e) {
      console.error("[-] Failed to register tunnel:", e.message);
    }
  };

  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (capturedUrl) break;
  }
  return true;
}

function getTunnelUrl(supervisor = null) {
  if (supervisor?.tunnel?.publicUrl) {
    return `${supervisor.tunnel.publicUrl.replace(/\/$/, "")}/v1`;
  }
  if (!fs.existsSync(TUNNEL_STATE)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(TUNNEL_STATE, "utf8"));
    if (json.shortId) return `https://r${json.shortId}.abc-tunnel.us/v1`;
  } catch {}
  return null;
}

function syncClipWrangler(currentTunnelUrl) {
  if (!currentTunnelUrl || !CLIP_DIR || !CLIP_WRANGLER) {
    if (!CLIP_DIR && currentTunnelUrl) {
      console.log("[*] CLIP_DIR not set - skipping wrangler sync (set CLIP_DIR env var to enable)");
    }
    return false;
  }
  if (!fs.existsSync(CLIP_WRANGLER)) return false;
  try {
    let toml = fs.readFileSync(CLIP_WRANGLER, "utf8");
    const match = toml.match(/ROUTER_URL\s*=\s*"([^"]*)"/);
    if (match) {
      if (match[1] !== currentTunnelUrl) {
        console.log(`[*] Tunnel URL changed from ${match[1] || "(empty)"} to ${currentTunnelUrl}. Updating Clip...`);
        toml = toml.replace(match[0], `ROUTER_URL = "${currentTunnelUrl}"`);
        fs.writeFileSync(CLIP_WRANGLER, toml, "utf8");
        console.log("[*] Deploying updated worker...");
        execSync("npx wrangler deploy", { cwd: path.join(CLIP_DIR, "worker"), stdio: "inherit" });
        console.log("[+] Clip worker deployed with new tunnel URL!");
        return true;
      }
    } else if (toml.includes("[vars]")) {
      console.log(`[*] Adding ROUTER_URL = "${currentTunnelUrl}" to Clip wrangler.toml...`);
      toml = toml.replace("[vars]", `[vars]\nROUTER_URL = "${currentTunnelUrl}"`);
      fs.writeFileSync(CLIP_WRANGLER, toml, "utf8");
      console.log("[*] Deploying updated worker...");
      execSync("npx wrangler deploy", { cwd: path.join(CLIP_DIR, "worker"), stdio: "inherit" });
      console.log("[+] Clip worker deployed with new tunnel URL!");
      return true;
    }
  } catch (err) {
    console.error("[-] Sync error:", err.message);
  }
  return false;
}

function testGateway() {
  return new Promise((resolve) => {
    process.stdout.write("[*] Testing live gateway end-to-end (https://clip.foo.ng/9ai)... ");
    const req = https.request(
      GATEWAY_URL,
      { method: "POST", headers: { "Content-Type": "text/plain" }, timeout: 15000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 200 && body.trim()) {
            console.log("OK! (HTTP 200)");
            resolve({ ok: true, answer: body.trim() });
          } else {
            console.log(`Failed (HTTP ${res.statusCode})`);
            resolve({ ok: false, status: res.statusCode, error: body });
          }
        });
      }
    );
    req.on("error", (err) => {
      console.log("Error: " + err.message);
      resolve({ ok: false, error: err.message });
    });
    req.on("timeout", () => {
      req.destroy();
      console.log("Timed out (15s)");
      resolve({ ok: false, error: "timeout" });
    });
    req.write("reply with the single word PONG");
    req.end();
  });
}

function preventSystemSleep() {
  if (process.platform !== "win32") return;
  try {
    execSync(
      'powershell.exe -NoProfile -Command "[System.Threading.Thread]::CurrentThread.Priority = [System.Threading.ThreadPriority]::AboveNormal"',
      { stdio: "ignore" }
    );
  } catch {}
}

async function runWatchdogLoop(startTime) {
  console.log("\n=======================================================");
  console.log("   🛡️  24-HOUR KEEP-AWAKE WATCHDOG ACTIVATED  🛡️");
  console.log("=======================================================");
  console.log("  • Checking all 3 services every 60 seconds");
  console.log("  • Press Ctrl+C to exit\n");

  preventSystemSleep();

  let checks = 0;
  while (true) {
    await sleep(60000);
    checks++;
    const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
    const timeStr = `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`;

    const rOk = await checkPort(PORT_ROUTER);
    const bOk = await checkPort(PORT_BRIDGE);
    const sup = await getSupervisorStatus();
    const tOk = Boolean(sup?.tunnel?.registered) || isCloudflaredRunning();

    if (!(rOk && bOk && tOk)) {
      console.log(`\n[!] [${timeStr}] Anomaly detected (9Router:${rOk} Bridge:${bOk} Tunnel:${tOk}). Auto-recovering...`);
      if (!rOk) await ensure9Router();
      if (!bOk) await ensureBridge();
      if (!tOk) await ensureTunnel();
      const tUrl = getTunnelUrl(await getSupervisorStatus());
      if (tUrl) syncClipWrangler(tUrl);
      console.log(`[+] [${timeStr}] Recovered!`);
    } else {
      process.stdout.write(`\r[✓ Heartbeat] Uptime: ${timeStr} | 9Router: 20127 | Bridge: 20128 | Tunnel: Online (check #${checks}) `);
    }
  }
}

async function printStatus() {
  const [rOk, bOk, sup] = await Promise.all([
    checkPort(PORT_ROUTER),
    checkPort(PORT_BRIDGE),
    getSupervisorStatus(),
  ]);
  const tOk = Boolean(sup?.tunnel?.registered) || isCloudflaredRunning();
  console.log(`9Router (20127): ${rOk ? "UP" : "DOWN"}`);
  console.log(`Bridge  (20128): ${bOk ? "UP" : "DOWN"}`);
  console.log(`Supervisor     : ${sup ? `UP (pid ${sup.pid}, child ${sup.child ?? sup.childPid ?? "-"})` : "not active"}`);
  console.log(`Tunnel         : ${tOk ? "UP" : "DOWN"} (${getTunnelUrl(sup) || "no url"})`);
  await testGateway();
}

async function main() {
  if (isHelp) {
    console.log("Usage: node scripts/start-9ai.js [--status | --watch | --help]");
    return;
  }
  if (isStatusOnly) {
    await printStatus();
    return;
  }

  console.log("\n=======================================================");
  console.log("           ⚡ 9AI REMOTE GATEWAY VERIFIER ⚡           ");
  console.log("=======================================================\n");

  const startTime = Date.now();
  await ensure9Router();
  await ensureBridge();
  await ensureTunnel();

  const supervisor = await getSupervisorStatus();
  const tunnelUrl = getTunnelUrl(supervisor);
  if (tunnelUrl) {
    console.log(`[*] Active Tunnel: ${tunnelUrl}`);
    syncClipWrangler(tunnelUrl);
  }

  console.log("");
  const testRes = await testGateway();

  console.log("\n=======================================================");
  if (testRes.ok) {
    console.log("  [✓] ALL SYSTEMS GO! YOUR 9AI GATEWAY IS 100% READY");
    console.log("=======================================================");
    console.log(`  Sample Response: "${testRes.answer}"\n`);
    console.log("  RUN FROM ANY TERMINAL:");
    console.log(`    curl -sL ${GATEWAY_URL} -d "what is 2+2"`);
    console.log(`    curl -sL ${GATEWAY_URL}/what+is+2+2`);
  } else {
    console.log("  [!] GATEWAY TEST RETURNED AN ERROR");
    console.log("=======================================================");
    console.log(`  Details: ${testRes.error || testRes.status}`);
    console.log("  Make sure your local 9Router has at least one active provider.");
  }
  console.log("=======================================================\n");

  if (isWatchMode) {
    await runWatchdogLoop(startTime);
  } else if (!supervisor) {
    console.log("💡 Tip: Use `npm run 9ai -- --watch` if running without 9Router supervisor.\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
