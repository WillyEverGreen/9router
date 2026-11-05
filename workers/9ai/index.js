// 9ai gateway — a tiny Cloudflare Worker that fronts your 9Router.
//
//   GET  /install   (gated)  emits a shell installer that writes ~/.local/bin/9ai
//   POST /ask       (gated)  text/plain prompt in, plain-text answer out
//   GET  /health             { ok, configured }
//
// The router URL and API key live in Worker secrets, so a client device only
// carries the gateway token. Nothing else is exposed.

const DEFAULT_MODEL = "ag/gemini-3.8-flash";

const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

// Installed on the user's machine. POSIX sh + curl only.
const CLIENT_SCRIPT = `#!/bin/sh
# 9ai - ask your 9Router from any terminal.
set -eu

usage() {
  echo 'usage: 9ai "question"'
  echo '       cat file | 9ai "summarize this"'
  echo '      9ai -m ag/gemini-3.8-flash-high "question"'
}

config="\${XDG_CONFIG_HOME:-$HOME/.config}/9ai/config"
API=""
TOKEN=""
MODEL=""
if [ -f "$config" ]; then
  . "$config"
fi
api="\${NINEAI_API:-$API}"
token="\${NINEAI_TOKEN:-$TOKEN}"
model="\${NINEAI_MODEL:-$MODEL}"

if [ -z "$api" ] || [ -z "$token" ]; then
  echo "9ai: not configured; reinstall from the gateway" >&2
  exit 2
fi

prompt=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--model)
      if [ $# -lt 2 ]; then
        echo "9ai: -m needs a model id" >&2
        exit 2
      fi
      model="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      ;;
    *)
      if [ -z "$prompt" ]; then
        prompt="$1"
      else
        prompt="$prompt $1"
      fi
      shift
      ;;
  esac
done

if [ ! -t 0 ]; then
  stdin_text=$(cat)
  if [ -n "$stdin_text" ]; then
    if [ -z "$prompt" ]; then
      prompt="$stdin_text"
    else
      prompt=$(printf '%s\\n\\n%s' "$prompt" "$stdin_text")
    fi
  fi
fi

if [ -z "$prompt" ]; then
  usage >&2
  exit 2
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
trap 'rm -f "$tmp"; exit 130' INT TERM

if [ -n "$model" ]; then
  set -- -H "X-9AI-Model: $model"
else
  set --
fi

if ! code=$(curl -sS --max-time 600 -o "$tmp" -w '%{http_code}' \\
    -H "Authorization: Bearer $token" \\
    -H 'Content-Type: text/plain' \\
    "$@" \\
    --data-binary "$prompt" \\
    "$api/ask"); then
  echo "9ai: could not reach $api" >&2
  exit 1
fi

if [ "$code" -ne 200 ]; then
  echo "9ai: request failed (HTTP $code)" >&2
  cat "$tmp" >&2
  echo >&2
  exit 1
fi

cat "$tmp"
echo
`;

// Served by GET /install; placeholders are filled per request.
const INSTALLER = `#!/bin/sh
# 9ai installer - writes ~/.local/bin/9ai and its config.
set -eu

api='__ORIGIN__'
token='__TOKEN__'
model='__MODEL__'

bindir="\${NINEAI_BIN:-$HOME/.local/bin}"
confdir="\${XDG_CONFIG_HOME:-$HOME/.config}/9ai"

command -v curl >/dev/null 2>&1 || { echo "9ai: curl is required" >&2; exit 1; }

mkdir -p "$bindir" "$confdir"
umask 077

cat > "$confdir/config" <<CONFIG
API="$api"
TOKEN="$token"
MODEL="$model"
CONFIG
chmod 600 "$confdir/config"

cat > "$bindir/9ai" <<'CLIENT'
__CLIENT__
CLIENT
chmod 755 "$bindir/9ai"

echo "installed $bindir/9ai"
case ":$PATH:" in
  *":$bindir:"*) ;;
  *) echo "note: add $bindir to PATH so 9ai is found" ;;
esac
echo 'try: 9ai "what is 2+2"'
`;

function text(body, status = 200) {
  return new Response(body, { status, headers: TEXT_HEADERS });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function presentedToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function configProblem(env) {
  if (!env.AUTH_TOKEN) return "AUTH_TOKEN is not set (Sites -> Secrets)";
  if (!env.ROUTER_URL) return "ROUTER_URL is not set (Sites -> Secrets)";
  if (!env.ROUTER_KEY) return "ROUTER_KEY is not set (Sites -> Secrets)";
  return "";
}

function routerBase(url) {
  return String(url || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function upstreamError(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message || parsed?.message || raw.slice(0, 300);
  } catch {
    return String(raw || "").slice(0, 300);
  }
}

function installer(origin, env) {
  return INSTALLER.replace("__ORIGIN__", () => origin)
    .replace("__TOKEN__", () => env.AUTH_TOKEN)
    .replace("__MODEL__", () => env.DEFAULT_MODEL || DEFAULT_MODEL)
    .replace("__CLIENT__", () => CLIENT_SCRIPT);
}

async function handleAsk(request, env) {
  const raw = await request.text();
  let prompt = raw;
  let model = request.headers.get("x-9ai-model") || env.DEFAULT_MODEL || DEFAULT_MODEL;

  if ((request.headers.get("content-type") || "").includes("application/json")) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return text("9ai: invalid JSON body", 400);
    }
    prompt = parsed?.prompt ?? parsed?.message ?? "";
    if (parsed?.model) model = String(parsed.model);
  }

  prompt = typeof prompt === "string" ? prompt.trim() : "";
  if (!prompt) return text("9ai: empty prompt", 400);
  if (prompt.length > 100000) return text("9ai: prompt too large", 413);

  const base = routerBase(env.ROUTER_URL);
  let response;
  try {
    response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ROUTER_KEY}`,
      },
      body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: prompt }] }),
    });
  } catch (err) {
    return text(`9ai: cannot reach the router (${base}): ${err?.message || err}`, 502);
  }

  const body = await response.text();
  if (!response.ok) {
    return text(`9ai: router returned HTTP ${response.status}: ${upstreamError(body)}`, 502);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return text(`9ai: unexpected router response: ${body.slice(0, 300)}`, 502);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content) return text(content);
  if (typeof data?.content === "string" && data.content) return text(data.content);
  if (data?.error) return text(`9ai: router error: ${upstreamError(body)}`, 502);
  return text(`9ai: router returned no text (${body.slice(0, 300)})`, 502);
}

function authError(request, env, token) {
  if (!env.AUTH_TOKEN) return text("9ai: AUTH_TOKEN is not set (Sites -> Secrets)", 503);
  const presented = token === undefined ? presentedToken(request) : token;
  if (!sameToken(presented, env.AUTH_TOKEN)) return text("9ai: unauthorized", 401);
  return null;
}

function routerMissing(env) {
  if (!env.ROUTER_URL) return text("9ai: ROUTER_URL is not set (Sites -> Secrets)", 503);
  if (!env.ROUTER_KEY) return text("9ai: ROUTER_KEY is not set (Sites -> Secrets)", 503);
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const problem = configProblem(env);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: !problem, configured: !problem, service: "9ai", model: env.DEFAULT_MODEL || DEFAULT_MODEL });
    }

    if (url.pathname === "/install") {
      if (request.method !== "GET") return text("9ai: method not allowed", 405);
      return authError(request, env) || routerMissing(env) || text(installer(url.origin, env));
    }

    if (url.pathname === "/i" || url.pathname.startsWith("/i/")) {
      if (request.method !== "GET") return text("9ai: method not allowed", 405);
      let token = "";
      try {
        token = decodeURIComponent(url.pathname.slice(2).replace(/^\//, "") || url.searchParams.get("t") || "");
      } catch {
        return text("9ai: bad token encoding", 400);
      }
      return authError(request, env, token) || routerMissing(env) || text(installer(url.origin, env));
    }

    if (url.pathname === "/ask") {
      if (request.method !== "POST") return text("9ai: method not allowed", 405);
      return authError(request, env) || routerMissing(env) || handleAsk(request, env);
    }

    return text("9ai: not found", 404);
  },
};
