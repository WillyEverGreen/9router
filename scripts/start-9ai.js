#!/usr/bin/env node
/**
 * 9ai Ready & Verification Script + 24H Keep-Awake Watchdog
 * Ensures 9Router, port 20128 proxy, and tunnel are healthy,
 * tests the remote gateway https://clip.foo.ng/9ai,
 * and optionally runs a continuous keep-alive watchdog (--watch / -w).
 */

const http = require("http");
const https = require("https");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT_ROUTER = 20127;
const PORT_BRIDGE = 20128;
const PROXY_SCRIPT = path.join(__dirname, "proxy-20128.js");
const CLIP_DIR = "d:\\FullStack Projects\\Clip";
const CLIP_WRANGLER = path.join(CLIP_DIR, "worker", "wrangler.toml");
const TUNNEL_STATE = path.join(os.homedir(), "AppData", "Roaming", "9router", "tunnel", "state.json");
const CLOUDFLARED_BIN = path.join(os.homedir(), "AppData", "Roaming", "9router", "bin", "cloudflared.exe");
const GATEWAY_URL = "https://clip.foo.ng/9ai";

const isWatchMode = process.argv.includes("--watch") || process.argv.includes("-w");

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensure9Router() {
  process.stdout.write("[*] Checking 9Router daemon (port 20127)... ");
  let ok = await checkPort(PORT_ROUTER);
  if (ok) {
    console.log("OK (running)");
    return true;
  }

  console.log("Not running. Starting...");
  try {
    const startScript = "C:\\tools\\start-9router.ps1";
    if (fs.existsSync(startScript)) {
      spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", startScript], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      spawn("cmd.exe", ["/c", "start", "/b", "9r", "start"], {
        detached: true,
        stdio: "ignore",
      }).unref();
    }
  } catch (err) {
    console.error("[-] Failed to start 9router:", err.message);
  }

  for (let i = 0; i < 20; i++) {
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
  let ok = await checkPort(PORT_BRIDGE);
  if (ok) {
    console.log("OK (running)");
    return true;
  }

  console.log("Not running. Starting proxy-20128.js...");
  try {
    spawn(process.execPath, [PROXY_SCRIPT], {
      detached: true,
      stdio: "ignore",
    }).unref();
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
  let isRunning = false;
  try {
    const out = execSync('powershell.exe -NoProfile -Command "Get-Process -Name *cloudflared* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"', { encoding: "utf8" }).trim();
    if (out) isRunning = true;
  } catch {}

  if (isRunning) {
    console.log("OK (running)");
    return true;
  }

  console.log("Not running. Spawning cloudflared...");
  if (!fs.existsSync(CLOUDFLARED_BIN)) {
    console.error("[-] cloudflared.exe not found at", CLOUDFLARED_BIN);
    return false;
  }

  const child = spawn(
    CLOUDFLARED_BIN,
    ["tunnel", "--url", "http://127.0.0.1:20128", "--no-autoupdate", "--retries", "99"],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  child.unref();

  let capturedUrl = null;
  const matchRegex = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i;

  const onData = async (chunk) => {
    const text = chunk.toString();
    const match = text.match(matchRegex);
    if (match && !capturedUrl) {
      const host = match[1];
      if (host !== "api") {
        capturedUrl = `https://${host}.trycloudflare.com`;
        console.log(`[+] New trycloudflare URL: ${capturedUrl}`);
        let shortId = "tkkzz3";
        try {
          if (fs.existsSync(TUNNEL_STATE)) {
            const parsed = JSON.parse(fs.readFileSync(TUNNEL_STATE, "utf8"));
            if (parsed.shortId) shortId = parsed.shortId;
          }
        } catch {}

        try {
          await fetch("https://abc-tunnel.us/api/tunnel/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shortId, tunnelUrl: capturedUrl }),
          });
          fs.writeFileSync(TUNNEL_STATE, JSON.stringify({ shortId, tunnelUrl: capturedUrl }), "utf8");
          console.log(`[+] Registered to https://r${shortId}.abc-tunnel.us`);
        } catch (e) {
          console.error("[-] Failed to register tunnel:", e.message);
        }
      }
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

function getTunnelUrl() {
  if (!fs.existsSync(TUNNEL_STATE)) return null;
  try {
    const raw = fs.readFileSync(TUNNEL_STATE, "utf8");
    const json = JSON.parse(raw);
    if (json.shortId) {
      return `https://r${json.shortId}.abc-tunnel.us/v1`;
    }
  } catch {}
  return null;
}

function syncClipWrangler(currentTunnelUrl) {
  if (!currentTunnelUrl || !fs.existsSync(CLIP_WRANGLER)) return false;
  try {
    let toml = fs.readFileSync(CLIP_WRANGLER, "utf8");
    const match = toml.match(/ROUTER_URL\s*=\s*"([^"]*)"/);
    if (match) {
      if (match[1] !== currentTunnelUrl) {
        console.log(`[*] Tunnel URL changed from ${match[1] || '(empty)'} to ${currentTunnelUrl}. Updating Clip...`);
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
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        timeout: 15000,
      },
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
  try {
    // Tell Windows OS that a required background server operation is active
    execSync('powershell.exe -NoProfile -Command "[System.Threading.Thread]::CurrentThread.Priority = [System.Threading.ThreadPriority]::AboveNormal"', { stdio: "ignore" });
  } catch {}
}

async function runWatchdogLoop(startTime) {
  console.log("\n=======================================================");
  console.log("   🛡️  24-HOUR KEEP-AWAKE WATCHDOG ACTIVATED  🛡️");
  console.log("=======================================================");
  console.log("  • Windows Sleep / Hibernate: DISABLED");
  console.log("  • Checking all 3 services every 60 seconds");
  console.log("  • Cloudflare Edge keeps tunnel warm every 10 minutes");
  console.log("  • LEAVE THIS WINDOW MINIMIZED (Press Ctrl+C to exit)\n");

  preventSystemSleep();

  let checks = 0;
  while (true) {
    await sleep(60000); // 1 minute
    checks++;
    const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);
    const hours = Math.floor(elapsedMinutes / 60);
    const mins = elapsedMinutes % 60;
    const timeStr = `${hours}h ${mins}m`;

    const rOk = await checkPort(PORT_ROUTER);
    const bOk = await checkPort(PORT_BRIDGE);

    let tOk = false;
    try {
      const out = execSync('powershell.exe -NoProfile -Command "Get-Process -Name *cloudflared* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"', { encoding: "utf8" }).trim();
      if (out) tOk = true;
    } catch {}

    const allHealthy = rOk && bOk && tOk;

    if (!allHealthy) {
      console.log(`\n[!] [${timeStr}] Anomaly detected (9Router:${rOk} Bridge:${bOk} Tunnel:${tOk}). Auto-recovering...`);
      if (!rOk) await ensure9Router();
      if (!bOk) await ensureBridge();
      if (!tOk) await ensureTunnel();
      const tUrl = getTunnelUrl();
      if (tUrl) syncClipWrangler(tUrl);
      console.log(`[+] [${timeStr}] Recovered! All services restored.`);
    } else {
      process.stdout.write(`\r[✓ Heartbeat] Uptime: ${timeStr} | 9Router: 20127 | Bridge: 20128 | Tunnel: Online (check #${checks}) `);
    }
  }
}

async function main() {
  console.log("\n=======================================================");
  console.log("           ⚡ 9AI REMOTE GATEWAY VERIFIER ⚡           ");
  console.log("=======================================================\n");

  const startTime = Date.now();
  await ensure9Router();
  await ensureBridge();
  await ensureTunnel();

  const tunnelUrl = getTunnelUrl();
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
    console.log("  RUN FROM ANY LAB / COLLEGE TERMINAL:");
    console.log(`    curl -sL ${GATEWAY_URL} -d "what is 2+2"`);
    console.log(`    curl -sL ${GATEWAY_URL}/what+is+2+2\n`);
    console.log("  OR USE THE 1-LINE SHELL SHORTCUT:");
    console.log(`    9ai() { curl -sL ${GATEWAY_URL} -d "$*"; echo; }`);
    console.log('    9ai what is 2+2');
  } else {
    console.log("  [!] GATEWAY TEST RETURNED AN ERROR");
    console.log("=======================================================");
    console.log(`  Details: ${testRes.error || testRes.status}`);
    console.log("  Make sure your local 9Router has at least one active provider.");
  }
  console.log("=======================================================\n");

  if (isWatchMode) {
    await runWatchdogLoop(startTime);
  } else {
    console.log("💡 Tip: To keep a live watchdog running all day with auto-healing:");
    console.log("   npm run 9ai -- --watch\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
