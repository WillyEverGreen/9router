# 9ai Remote Gateway Setup Guide

Complete setup guide for the 9ai Cloudflare Worker gateway that allows terminal access to your 9Router from anywhere.

## Overview

The 9ai gateway system consists of:
- **Cloudflare Worker** (`workers/9ai/index.js`) - Hosted gateway with auth
- **Local watchdog** (`scripts/start-9ai.js`) - Keeps services running 24/7 (or attaches cleanly when `C:\tools\9router\supervisor.cjs` is active on `127.0.0.1:20129`)
- **Port bridge** (`scripts/proxy-20128.js`, or built into `supervisor.cjs`) - Routes 20128 → 20127
- **Tunnel** - Cloudflare tunnel exposes local router to the Worker

## Prerequisites

1. **9Router running locally** on port 20127
2. **Cloudflare account** (free tier works)
3. **cloudflared binary** installed (the watchdog will install it automatically to `%APPDATA%\9router\bin\cloudflared.exe`)
4. **Node.js** v18+ 
5. **wrangler CLI** (optional, for deploying the Worker)

## Step 1: Deploy the Cloudflare Worker

### Option A: Using Wrangler (Recommended)

```bash
cd workers/9ai
npm install -g wrangler
wrangler login
wrangler deploy
```

### Option B: Manual via Cloudflare Dashboard

1. Go to Cloudflare Dashboard → Workers & Pages
2. Create a new Worker
3. Copy the contents of `workers/9ai/index.js` into the editor
4. Deploy

## Step 2: Configure Worker Secrets

In Cloudflare Dashboard → Your Worker → Settings → Variables:

```bash
# Required secrets
AUTH_TOKEN=<generate with: openssl rand -hex 24>
ROUTER_URL=https://your-tunnel-url.trycloudflare.com/v1
ROUTER_KEY=sk_xxx_your_9router_api_key

# Optional
DEFAULT_MODEL=ag/gemini-3.8-flash
```

**Important:** 
- `AUTH_TOKEN` should be long and random (48+ characters)
- `ROUTER_URL` comes from the tunnel (see Step 3)
- `ROUTER_KEY` is from 9Router Dashboard → API Keys

## Step 3: Start the Local Watchdog

The watchdog:
- ✅ Starts 9Router if not running (port 20127)
- ✅ Starts the port bridge (20128 → 20127)
- ✅ Launches Cloudflare tunnel
- ✅ Registers tunnel URL with abc-tunnel.us
- ✅ Auto-syncs Worker config when tunnel URL changes (if CLIP_DIR is set)
- ✅ Monitors all services 24/7 with auto-recovery

```bash
# One-time test
npm run 9ai

# Or: node scripts/start-9ai.js

# For 24/7 watchdog mode
npm run 9ai -- --watch
```

### Environment Variables (Optional)

```bash
# Windows PowerShell
$env:CLIP_DIR = "D:\Projects\Clip"

# Linux/Mac
export CLIP_DIR="/path/to/clip/worker"
```

If `CLIP_DIR` is set, the watchdog will automatically update `worker/wrangler.toml` with the new tunnel URL and redeploy the Worker when the tunnel changes.

If not set, you'll need to manually update the `ROUTER_URL` secret in Cloudflare Dashboard when the tunnel URL changes.

## Step 4: Get the Tunnel URL

After starting the watchdog, you'll see:

```
[+] New trycloudflare URL: https://xxx-yyy-zzz.trycloudflare.com
[+] Registered to https://rtkkzz3.abc-tunnel.us
[*] Active Tunnel: https://rtkkzz3.abc-tunnel.us/v1
```

Copy the tunnel URL and update the Worker's `ROUTER_URL` secret (if not auto-synced).

## Step 5: Test the Gateway

```bash
# Health check
curl https://your-worker.workers.dev/health

# Should return: {"ok":true,"configured":true,"service":"9ai","model":"ag/gemini-3.8-flash"}
```

## Step 6: Install the CLI on Remote Machines

On any Linux/Mac machine with `curl`:

```bash
# Install
curl -fsSL https://your-worker.workers.dev/i/<AUTH_TOKEN> | sh

# Or keep token out of URL
curl -fsSL -H "Authorization: Bearer <AUTH_TOKEN>" https://your-worker.workers.dev/install | sh
```

This installs `~/.local/bin/9ai` with the config stored in `~/.config/9ai/config`.

## Step 7: Use It!

```bash
# Basic usage
9ai "what is 2+2"

# Pipe input
git diff | 9ai "review this code"

# Override model
9ai -m kr/claude-sonnet-4.5 "explain quantum computing"

# Use as context
cat error.log | 9ai "debug this error"
```

## Troubleshooting

### "cloudflared: spawn EPERM"

**Cause:** Antivirus, Windows execution policy, or permissions issue.

**Fix:**
1. Check antivirus logs and whitelist `cloudflared.exe`
2. Run cloudflared manually to test:
   ```powershell
   & "$env:APPDATA\9router\bin\cloudflared.exe" tunnel --url http://127.0.0.1:20128
   ```
3. Or use an external tunnel service

### "CLIP_DIR not set - skipping wrangler sync"

**Not an error** - This is informational. The watchdog detected a tunnel URL change but won't auto-deploy because `CLIP_DIR` is not configured.

**To enable auto-sync:**
```powershell
$env:CLIP_DIR = "D:\Projects\Clip"
```

### "9ai: unauthorized"

Your `AUTH_TOKEN` doesn't match. Reinstall:
```bash
curl -fsSL https://your-worker.workers.dev/i/<NEW_AUTH_TOKEN> | sh
```

### "9ai: cannot reach the router"

1. Check the Worker's `ROUTER_URL` is correct
2. Verify the tunnel is running locally
3. Test manually: `curl https://your-tunnel-url/v1/models`

### "Gateway test returned an error"

1. Ensure at least one provider is active in 9Router Dashboard
2. Check the `ROUTER_KEY` has permissions
3. Test the API key locally: 
   ```bash
   curl http://localhost:20127/v1/chat/completions \
     -H "Authorization: Bearer sk_..." \
     -H "Content-Type: application/json" \
     -d '{"model":"kr/claude-sonnet-4.5","messages":[{"role":"user","content":"hi"}]}'
   ```

## Architecture

```
┌─────────────────┐
│  Remote Machine │
│   (any Linux)   │
└────────┬────────┘
         │ curl https://your-worker.workers.dev/ask
         │ -H "Authorization: Bearer <TOKEN>"
         │ -d "what is 2+2"
         ↓
┌─────────────────────────┐
│  Cloudflare Worker      │
│  (workers/9ai/index.js) │
│  • Auth via AUTH_TOKEN  │
│  • Holds ROUTER_URL/KEY │
└────────┬────────────────┘
         │ https://rtkkzz3.abc-tunnel.us/v1/chat/completions
         │ -H "Authorization: Bearer $ROUTER_KEY"
         ↓
┌─────────────────────────┐
│  Cloudflare Tunnel      │
│  (cloudflared)          │
│  rtkkzz3.abc-tunnel.us  │
│  ↓                      │
│  127.0.0.1:20128        │
└────────┬────────────────┘
         │
┌─────────────────────────┐
│  Port Bridge            │
│  (proxy-20128.js)       │
│  20128 → 20127          │
└────────┬────────────────┘
         │
┌─────────────────────────┐
│  9Router                │
│  localhost:20127        │
│  • Format translation   │
│  • Provider routing     │
│  • Token saving (RTK)   │
└─────────────────────────┘
```

## Security Notes

1. **AUTH_TOKEN** should be strong (48+ chars) - it's your only protection
2. The Worker URL is public - anyone with `AUTH_TOKEN` can use it
3. Consider rate limiting in the Worker for production use
4. Rotate `AUTH_TOKEN` periodically by updating the secret and reinstalling
5. Never commit `wrangler.toml` if it contains secrets
6. Use API key restrictions in 9Router Dashboard (per-provider, per-model)

## Advanced: Auto-Start on Boot (Windows)

Create a Task Scheduler task:

1. Open Task Scheduler
2. Create Basic Task → "9ai Watchdog"
3. Trigger: At startup
4. Action: Start a program
   - Program: `node.exe`
   - Arguments: `D:\path\to\9router\scripts\start-9ai.js --watch`
   - Start in: `D:\path\to\9router`
5. Conditions: Uncheck "Start only if on AC power"
6. Settings: Check "If task fails, restart every 5 minutes"

## Advanced: Custom Domain

In Cloudflare Dashboard → Workers → Your Worker → Settings → Triggers:

1. Add a custom domain (e.g., `ai.example.com`)
2. Update install command:
   ```bash
   curl -fsSL https://ai.example.com/i/<TOKEN> | sh
   ```

## Monitoring

The watchdog prints status every 60 seconds:

```
[✓ Heartbeat] Uptime: 3h 24m | 9Router: 20127 | Bridge: 20128 | Tunnel: Online (check #204)
```

If any service fails, it auto-recovers:
```
[!] [3h 25m] Anomaly detected (9Router:true Bridge:false Tunnel:true). Auto-recovering...
[+] [3h 25m] Recovered! All services restored.
```

## FAQ

**Q: Do I need to keep the terminal open?**  
A: For `--watch` mode, yes (or run as a background service/task). For one-time tests, no.

**Q: Can I use this from Windows clients?**  
A: The shell client is POSIX-only. Windows users should call the Worker API directly with `curl` or PowerShell's `Invoke-RestMethod`.

**Q: Does this cost money?**  
A: Cloudflare Workers free tier: 100k requests/day. Cloudflare Tunnel: free. You only pay for your provider usage (9Router → Claude/OpenAI/etc).

**Q: Can I deploy multiple Workers for different teams?**  
A: Yes! Each Worker has its own `AUTH_TOKEN`, `ROUTER_URL`, and `ROUTER_KEY`. Point them at different 9Router instances or the same one with different API keys.

**Q: The tunnel URL changes daily. How do I handle this?**  
A: 
1. Use `abc-tunnel.us` registration - it gives you a stable short URL
2. Enable `CLIP_DIR` auto-sync to redeploy the Worker automatically
3. Or use Cloudflare Tunnel with a named tunnel (requires paid plan)

**Q: Can I add rate limiting?**  
A: Yes! Add this to the Worker:

```javascript
// In workers/9ai/index.js, after authentication
const ip = request.headers.get("cf-connecting-ip");
// Use Durable Objects or KV to track request counts per IP
// Return 429 if exceeded
```

## Support

- Issues: https://github.com/WillyEverGreen/9router/issues
- Upstream: https://github.com/decolua/9router
- Docs: https://9router.com
