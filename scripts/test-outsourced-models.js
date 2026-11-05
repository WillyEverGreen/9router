#!/usr/bin/env node
/**
 * 9Router Model Verification Suite
 * Tests models across all providers (Zed, Kiro, Codex, Antigravity, Shortcuts)
 * Usage:
 *   node scripts/test-outsourced-models.js            # Tests representative models
 *   node scripts/test-outsourced-models.js --all      # Tests all available chat models
 *   node scripts/test-outsourced-models.js zed        # Tests Zed models only
 *   node scripts/test-outsourced-models.js kiro       # Tests Kiro models only
 *   node scripts/test-outsourced-models.js codex      # Tests Codex models only
 *   node scripts/test-outsourced-models.js ag         # Tests Antigravity models only
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BASE_URL = (process.env.NINE_ROUTER_URL || `http://127.0.0.1:${process.env.PORT || 20127}`).replace(/\/$/, "");

function getApiKey() {
  if (process.env.NINE_ROUTER_API_KEY) return process.env.NINE_ROUTER_API_KEY;
  try {
    const claudeSettings = JSON.parse(
      readFileSync(path.join(homedir(), ".claude", "settings.json"), "utf8")
    );
    return claudeSettings?.env?.ANTHROPIC_API_KEY || "";
  } catch {
    return "";
  }
}

const API_KEY = getApiKey();
const headers = {
  "Content-Type": "application/json",
  ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {})
};

function parseSseText(text) {
  let content = "";
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) continue;
    const dataStr = trimmed.slice(5).trim();
    if (dataStr === "[DONE]") continue;
    try {
      const parsed = JSON.parse(dataStr);
      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === "string") content += delta;
      const msg = parsed.choices?.[0]?.message?.content;
      if (typeof msg === "string") content += msg;
    } catch {
      // ignore individual chunk parse errors
    }
  }
  return content;
}

async function testSingleModel(model) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
        max_tokens: 30
      }),
      signal: AbortSignal.timeout(45000)
    });

    const elapsed = Date.now() - t0;
    const rawText = await res.text();

    if (!res.ok) {
      let errMsg = rawText;
      try {
        const j = JSON.parse(rawText);
        errMsg = j.error?.message || j.message || rawText;
      } catch {}
      return { ok: false, elapsed, error: errMsg.slice(0, 120).replace(/\s+/g, " ") };
    }

    let reply = "";
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream") || rawText.trim().startsWith("data:")) {
      reply = parseSseText(rawText);
    } else {
      try {
        const j = JSON.parse(rawText);
        reply = j.choices?.[0]?.message?.content || "";
      } catch {
        reply = rawText;
      }
    }

    reply = reply.trim().replace(/\s+/g, " ");

    if (reply.includes("[Zed error]") || reply.includes("[error]")) {
      return { ok: false, elapsed, error: reply.slice(0, 120) };
    }

    return { ok: true, elapsed, reply: reply.slice(0, 40) || "(empty response)" };
  } catch (err) {
    return { ok: false, elapsed: Date.now() - t0, error: err.message };
  }
}

async function getAvailableModels() {
  const res = await fetch(`${BASE_URL}/v1/models`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch models from 9Router (HTTP ${res.status}). Is server running?`);
  }
  const data = await res.json();
  return (data.data || []).map((m) => m.id);
}

const REPRESENTATIVE_MODELS = [
  // Quick Shortcuts
  "sonnet-5.5",
  "deepseek",
  "terra",
  "qwen",
  "glm",
  // Zed Models (Anthropic, OpenAI, Google)
  "zd/claude-sonnet-5-5",
  "zd/claude-haiku-5-5",
  "zd/gpt-6-luna",
  "zd/gpt-5.6-terra",
  "zd/gemini-3.8-flash",
  // Kiro Models
  "kr/claude-sonnet-4.5",
  "kr/deepseek-3.2",
  "kr/qwen3-coder-next",
  "kr/glm-5",
  // Codex Models
  "cx/gpt-6-luna",
  "cx/gpt-5.6-terra",
  // Antigravity Models
  "ag/gemini-3.8-flash-high",
  "ag/gemini-3.8-flash",
  "ag/claude-sonnet-4-6"
];

async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes("--all");
  const filter = args.find((a) => !a.startsWith("--"))?.toLowerCase();

  console.log("===============================================================================");
  console.log("                     9ROUTER MODEL VERIFICATION SUITE                          ");
  console.log(`                     Target: ${BASE_URL}                                `);
  console.log("===============================================================================\n");

  let modelsToTest = [];
  try {
    const allModels = await getAvailableModels();

    if (isAll) {
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
      // Pick models that are available from the representative list
      modelsToTest = REPRESENTATIVE_MODELS.filter((m) => allModels.includes(m));
    }
  } catch (err) {
    console.error(`[!] ${err.message}\n`);
    process.exit(1);
  }

  if (modelsToTest.length === 0) {
    console.log("No matching models found to test.");
    return;
  }

  console.log(`Testing ${modelsToTest.length} model(s)...\n`);
  let passed = 0;
  let failed = 0;

  for (const model of modelsToTest) {
    process.stdout.write(`  • Testing ${model.padEnd(30)} ... `);
    const result = await testSingleModel(model);
    if (result.ok) {
      passed++;
      console.log(`[PASS] (${result.elapsed}ms) -> "${result.reply}"`);
    } else {
      failed++;
      console.log(`[FAIL] (${result.elapsed}ms) -> ${result.error}`);
    }
  }

  console.log("\n===============================================================================");
  console.log(`SUMMARY: ${passed} Passed, ${failed} Failed out of ${modelsToTest.length} tested.`);
  console.log("===============================================================================\n");
  
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
