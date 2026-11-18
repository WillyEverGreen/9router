#!/usr/bin/env node
/**
 * 9Router Model Verification Suite
 * Tests models across Zed, Kiro, Codex, Antigravity, Freebuff presets, and multi-turn roundtrips.
 * Usage:
 *   node scripts/test-outsourced-models.js                  # Representative models
 *   node scripts/test-outsourced-models.js --freebuff       # Freebuff 10-model set
 *   node scripts/test-outsourced-models.js --roundtrip      # Also verify reasoning/tool replay on zd/gemini-4-argon
 *   node scripts/test-outsourced-models.js --all            # All available chat models
 *   node scripts/test-outsourced-models.js --no-stream zed  # Non-streaming check on Zed models
 */

const BASE_URL = (process.env.NINE_ROUTER_URL || `http://127.0.0.1:${process.env.PORT || 20127}`).replace(/\/$/, "");

const FREEBUFF_MODELS = [
  "kr/claude-sonnet-4.5-thinking",
  "kr/claude-haiku-4.5",
  "kr/deepseek-3.2",
  "kr/qwen3-coder-next",
  "ag/claude-opus-4-6-thinking",
  "ag/claude-sonnet-4-6",
  "ag/gemini-3.8-flash-high",
  "cx/gpt-6-astra",
  "cx/gpt-6-luna",
  "cx/gpt-5.6-terra",
];

const REPRESENTATIVE_MODELS = [
  "astra",
  "deepseek-v4.1-flash-free",
  "beam-free",
  "nemotron-3.5-super-vl-free",
  "sonnet-5.5",
  "deepseek",
  "terra",
  "qwen",
  "glm",
  "kr/claude-sonnet-4.5",
  "kr/claude-haiku-4.5",
  "kr/deepseek-3.2",
  "kr/qwen3-coder-next",
  "kr/glm-5",
  "oc/deepseek-v4.1-flash-free",
  "oc/beam-free",
  "oc/nemotron-3.5-super-vl-free",
  "cx/gpt-6-astra",
  "cx/gpt-6-luna",
  "cx/gpt-5.6-terra",
  "cx/gpt-6.1-sol",
  "cx/gpt-6.1-terra",
  "ag/claude-opus-4-6-thinking",
  "ag/claude-sonnet-4-6",
  "ag/gemini-3.8-flash-high",
];

function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function parseSseResponse(text) {
  let content = "";
  let reasoning = "";
  let errorMsg = "";
  const toolCalls = new Map();

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || !trimmed.startsWith("data:")) continue;
    const dataStr = trimmed.slice(5).trim();
    if (dataStr === "[DONE]") continue;
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.error) {
        errorMsg = parsed.error?.message || JSON.stringify(parsed.error);
        continue;
      }
      const choice = parsed.choices?.[0];
      if (!choice) continue;
      const src = choice.delta || choice.message || {};
      if (typeof src.content === "string") content += src.content;
      if (typeof src.reasoning_content === "string") reasoning += src.reasoning_content;
      if (Array.isArray(src.tool_calls)) {
        for (const tc of src.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolCalls.get(idx) || { id: tc.id || `call_${idx}`, name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolCalls.set(idx, cur);
        }
      }
    } catch {
      // Ignore partial/malformed SSE comment frames
    }
  }

  return { content, reasoning, errorMsg, toolCalls: [...toolCalls.values()] };
}

function parseCompletionPayload(rawText, contentType) {
  if (contentType.includes("text/event-stream") || rawText.trim().startsWith("data:")) {
    return parseSseResponse(rawText);
  }
  try {
    const parsed = JSON.parse(rawText);
    if (parsed.error) {
      return { content: "", reasoning: "", errorMsg: parsed.error?.message || JSON.stringify(parsed.error), toolCalls: [] };
    }
    const msg = parsed.choices?.[0]?.message || {};
    return {
      content: typeof msg.content === "string" ? msg.content : "",
      reasoning: typeof msg.reasoning_content === "string" ? msg.reasoning_content : "",
      errorMsg: "",
      toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    };
  } catch {
    return { content: rawText, reasoning: "", errorMsg: "", toolCalls: [] };
  }
}

async function runChatProbe(model, headers, { stream = true, messages = null, tools = null } = {}) {
  const isThinking = /thinking|argon|opus-4-6|sonnet-4\.5|sonnet-5|terra|luna/i.test(model);
  const maxTokens = isThinking ? 512 : 128;
  const payload = {
    model,
    stream,
    max_tokens: maxTokens,
    messages: messages || [{ role: "user", content: "Reply with the single word: OK" }],
    ...(tools ? { tools } : {}),
  };

  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    const elapsed = Date.now() - t0;
    const rawText = await res.text();

    if (!res.ok) {
      let errMsg = rawText;
      try {
        const j = JSON.parse(rawText);
        errMsg = j.error?.message || j.message || rawText;
      } catch {}
      return { ok: false, elapsed, error: `HTTP ${res.status}: ${errMsg.slice(0, 140).replace(/\s+/g, " ")}` };
    }

    const parsed = parseCompletionPayload(rawText, res.headers.get("content-type") || "");
    if (parsed.errorMsg) {
      return { ok: false, elapsed, error: parsed.errorMsg.slice(0, 140) };
    }

    const combined = (parsed.content || "").trim().replace(/\s+/g, " ");
    const reasonText = (parsed.reasoning || "").trim().replace(/\s+/g, " ");
    if (combined.includes("[Zed error]") || combined.includes("[error]")) {
      return { ok: false, elapsed, error: combined.slice(0, 140) };
    }
    if (!combined && !reasonText && parsed.toolCalls.length === 0) {
      return { ok: false, elapsed, error: "(empty response)" };
    }

    const preview = combined
      ? combined.slice(0, 48)
      : reasonText
        ? `[reasoning] ${reasonText.slice(0, 36)}`
        : `[tool_call] ${parsed.toolCalls.map((t) => t.name || t.function?.name).join(",")}`;
    return { ok: true, elapsed, reply: preview };
  } catch (err) {
    return { ok: false, elapsed: Date.now() - t0, error: err.message };
  }
}

async function runArgonRoundtripProbe(headers, stream) {
  const messages = [
    { role: "user", content: "Check system status first." },
    {
      role: "assistant",
      reasoning_content: "Calling status tool before answering.",
      content: "",
      tool_calls: [
        { id: "call_probe_foreign_1", type: "function", function: { name: "get_status", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_probe_foreign_1", content: '{"healthy":true}' },
    { role: "user", content: "Summarize the tool output in one word: OK." },
  ];
  return runChatProbe("ag/gemini-3.8-flash-high", headers, { stream, messages });
}

async function getAvailableModels(headers) {
  const res = await fetch(`${BASE_URL}/v1/models`, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch models from 9Router (HTTP ${res.status}). Is server running at ${BASE_URL}?`);
  }
  const data = await res.json();
  return (data.data || []).map((m) => m.id);
}

function printHelp() {
  console.log(`Usage: node scripts/test-outsourced-models.js [options] [filter]

Options:
  --freebuff       Test the 10-model Freebuff BYOK set
  --roundtrip      Run cross-model reasoning + tool_calls replay probe
  --all            Test all non-media models returned by /v1/models
  --no-stream      Use non-streaming JSON responses instead of SSE streaming
  --help, -h       Show this help message

Filters:
  kiro | kr | codex | cx | ag | <substring>`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const isAll = args.includes("--all");
  const isFreebuff = args.includes("--freebuff");
  const runRoundtrip = args.includes("--roundtrip");
  const stream = !args.includes("--no-stream");
  const filter = args.find((a) => !a.startsWith("-"))?.toLowerCase();

  const { resolveRouterApiKey } = await import("./lib/routerEnv.mjs");
  const apiKey = await resolveRouterApiKey();
  const headers = buildHeaders(apiKey);

  console.log("===============================================================================");
  console.log("                     9ROUTER MODEL VERIFICATION SUITE                          ");
  console.log(`                     Target: ${BASE_URL} (${stream ? "SSE stream" : "non-stream"})`);
  console.log(`                     Auth:   ${apiKey ? "API key loaded" : "No API key (local mode)"}`);
  console.log("===============================================================================\n");

  let modelsToTest = [];
  try {
    const allModels = await getAvailableModels(headers);

    if (isFreebuff) {
      modelsToTest = FREEBUFF_MODELS;
    } else if (isAll) {
      modelsToTest = allModels.filter((m) => !/embed|image|tts|transcribe|review|\[1m\]/i.test(m));
    } else if (filter) {
      modelsToTest = allModels.filter((m) => {
        if (filter === "zed" || filter === "zd") return m.startsWith("zd/");
        if (filter === "kiro" || filter === "kr") return m.startsWith("kr/");
        if (filter === "codex" || filter === "cx") return m.startsWith("cx/");
        if (filter === "ag" || filter === "antigravity") return m.startsWith("ag/");
        return m.toLowerCase().includes(filter);
      });
    } else {
      modelsToTest = REPRESENTATIVE_MODELS.filter((m) => allModels.includes(m));
    }
  } catch (err) {
    console.error(`[!] ${err.message}\n`);
    process.exit(1);
  }

  if (modelsToTest.length === 0 && !runRoundtrip) {
    console.log("No matching models found to test.");
    return;
  }

  console.log(`Testing ${modelsToTest.length} model(s)...\n`);
  let passed = 0;
  let failed = 0;

  for (const model of modelsToTest) {
    process.stdout.write(`  * Testing ${model.padEnd(32)} ... `);
    const result = await runChatProbe(model, headers, { stream });
    if (result.ok) {
      passed++;
      console.log(`[PASS] (${result.elapsed}ms) -> "${result.reply}"`);
    } else {
      failed++;
      console.log(`[FAIL] (${result.elapsed}ms) -> ${result.error}`);
    }
  }

  if (runRoundtrip) {
    process.stdout.write(`  * Testing ag/gemini-3.8-flash-high [roundtrip]  ... `);
    const rt = await runArgonRoundtripProbe(headers, stream);
    if (rt.ok) {
      passed++;
      console.log(`[PASS] (${rt.elapsed}ms) -> "${rt.reply}"`);
    } else {
      failed++;
      console.log(`[FAIL] (${rt.elapsed}ms) -> ${rt.error}`);
    }
  }

  const total = modelsToTest.length + (runRoundtrip ? 1 : 0);
  console.log("\n===============================================================================");
  console.log(`SUMMARY: ${passed} Passed, ${failed} Failed out of ${total} check(s).`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

module.exports = { FREEBUFF_MODELS, REPRESENTATIVE_MODELS };

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
