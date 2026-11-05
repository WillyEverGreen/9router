# 9ai gateway (Cloudflare Worker)

A hosted front door for 9Router so any machine can just run:

```bash
9ai "what is 2+2"
```

The Worker holds the router URL and API key as secrets. A client machine only
gets a gateway token plus a shell script — no Node, no per-device URL/key setup.

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | `{ ok, configured }` |
| `GET /install` | `Authorization: Bearer <AUTH_TOKEN>` | emits an installer that writes `~/.local/bin/9ai` and `~/.config/9ai/config` |
| `GET /i/<token>` (or `/i?t=<token>`) | token in the path | same installer, so install is one short command |
| `POST /ask` | `Authorization: Bearer <AUTH_TOKEN>` | `text/plain` prompt in, plain-text answer out |
| `POST /ask` + `Content-Type: application/json` | same | `{"prompt":"...","model":"..."}` |
| `POST /ask` + `X-9AI-Model` header | same | per-request model override |

## One-time setup

1. **Make the router reachable.** Dashboard → Endpoint → Tunnel (Cloudflare or
   Tailscale) and copy the `https://...` URL. A Worker cannot reach a localhost
   router, so this step is required.
2. **Create a router key.** Dashboard → API Keys → Create, copy `sk_...`.
   Optionally restrict it to `ag/gemini-3.8-flash` (plus the `-high/-medium/-low`
   variants) so this gateway can only call what you intend.
3. **Set three secrets** in Sites → Secrets on this site:
   - `ROUTER_URL` — the tunnel URL from step 1 (`https://...`, no `/v1`)
   - `ROUTER_KEY` — the `sk_...` from step 2
   - `AUTH_TOKEN` — a random string of your own (`openssl rand -hex 24`); this is
     what devices present, so keep it long and private
   - optional `DEFAULT_MODEL` — defaults to `ag/gemini-3.8-flash`
4. **Install on any Linux box** (needs only `curl`):

   ```bash
   curl -fsSL https://<site>/i/<AUTH_TOKEN> | sh     # shortest
   curl -fsSL -H "Authorization: Bearer <AUTH_TOKEN>" https://<site>/install | sh   # keeps the token out of the URL
   ```

   The `/i/<token>` form puts the token in the URL, so it can land in shell
   history and server logs; use `/install` if that matters. A custom domain in
   Sites → Domains makes the command genuinely short
   (`curl -fsSL https://ai.example.com/i/<token> | sh`).

   That writes `~/.local/bin/9ai` and a `600` config. If `~/.local/bin` is not on
   `PATH`, add it once.

## Use

```bash
9ai "what is 2+2"                       # default model
git diff | 9ai "review this"            # stdin is the prompt context
9ai -m ag/gemini-3.8-flash-high "..."     # per-call model
NINEAI_MODEL=kr/claude-sonnet-4.5 9ai "..." # per-shell default
NINEAI_BIN=/usr/local/bin sh install.sh   # custom install dir
```

Exit codes: `0` answer, `1` network/router failure, `2` bad usage or missing config.

## Security notes

- Both `/install` and `/ask` are gated by `AUTH_TOKEN`; the router key never
  reaches a device. Rotate by changing `AUTH_TOKEN` in Sites → Secrets and
  reinstalling (old clients start getting `401`).
- The gateway is single-turn and stateless: no conversation is stored, here or
  on the client.
- `GET /health` is open and reveals only whether the site is configured.
- Preview URLs are public. Keep `AUTH_TOKEN` strong; without it anyone who finds
  the URL can spend your provider quota.

## Local check

`index.js` uses only `fetch`/`Request`/`Response`, so it can be exercised in plain
Node against a mock router before deploying. The throwaway harness used for that
is not kept in the repo.

## Files

- `index.js` — the Worker (routes, auth, proxy, embedded shell client/installer)
- `manifest.json` — deploy manifest (`entrypoint` + ESM module)
