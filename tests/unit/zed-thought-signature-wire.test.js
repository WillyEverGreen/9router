import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { zedLlmFetchMock, resolveZedModelsMock } = vi.hoisted(() => ({
  zedLlmFetchMock: vi.fn(),
  resolveZedModelsMock: vi.fn(),
}));

vi.mock("../../open-sse/shared/zedAuth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    zedLlmFetch: zedLlmFetchMock,
    resolveZedModels: resolveZedModelsMock,
  };
});

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let ZedExecutor;
let openaiToGeminiRequest;
let DEFAULT_THINKING_AG_SIGNATURE;
let closeAdapter;

function catalogFor(provider = "google") {
  return {
    models: [{ id: "gemini-4-argon", provider }],
    rawById: new Map([["gemini-4-argon", { id: "gemini-4-argon", provider }]]),
  };
}

function captureZedFetch(captured) {
  zedLlmFetchMock.mockImplementationOnce(async (_credentials, _endpoint, options) => {
    captured.body = JSON.parse(options.fetchOptions.body);
    return new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-zed-sig-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  ({ default: ZedExecutor } = await import("../../open-sse/executors/zed.js"));
  ({ openaiToGeminiRequest } = await import("../../open-sse/translator/request/openai-to-gemini.js"));
  ({ DEFAULT_THINKING_AG_SIGNATURE } = await import("../../open-sse/config/defaultThinkingSignature.js"));
  ({ closeAdapter } = await import("@/lib/db/driver.js"));
}, 15_000);

afterAll(async () => {
  await closeAdapter?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("ZedExecutor Google thoughtSignature & sessionId wiring", () => {
  it("replaces synthetic DEFAULT_THINKING_AG_SIGNATURE on Zed Google while leaving shared translator intact", async () => {
    resolveZedModelsMock.mockResolvedValue(catalogFor("google"));
    const captured = {};
    captureZedFetch(captured);
    const executor = new ZedExecutor();

    const multiTurnBody = {
      model: "gemini-4-argon",
      stream: true,
      messages: [
        { role: "user", content: "check weather" },
        {
          role: "assistant",
          reasoning_content: "need tool",
          content: "",
          tool_calls: [
            { id: "call_uncached_1", type: "function", function: { name: "lookup", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_uncached_1", content: "sunny" },
      ],
    };

    await executor.execute({
      model: "gemini-4-argon",
      body: multiTurnBody,
      stream: true,
      credentials: { _clientSessionId: "sess-uncached" },
    });

    const parts = captured.body.provider_request.contents.flatMap((turn) => turn.parts || []);
    const sigs = parts.filter((p) => p.thoughtSignature).map((p) => p.thoughtSignature);
    expect(sigs.length).toBeGreaterThanOrEqual(2);
    expect(sigs.every((s) => s === "skip_thought_signature_validator")).toBe(true);

    // Sanity: shared openaiToGeminiRequest still emits DEFAULT_THINKING_AG_SIGNATURE untouched.
    const sharedReq = openaiToGeminiRequest("gemini-4-argon", multiTurnBody, true, {
      _clientSessionId: "sess-shared",
    });
    const sharedSigs = sharedReq.contents
      .flatMap((t) => t.parts || [])
      .filter((p) => p.thoughtSignature)
      .map((p) => p.thoughtSignature);
    expect(sharedSigs).toContain(DEFAULT_THINKING_AG_SIGNATURE);
    expect(sharedSigs).not.toContain("skip_thought_signature_validator");
  });

  it("wires credentials._clientSessionId into SSE capture and preserves authentic signatures on turn 2", async () => {
    resolveZedModelsMock.mockResolvedValue(catalogFor("google"));
    const encoder = new TextEncoder();
    const authenticSig = "authentic-zed-sig-token-xyz-999";
    const ndjson = [
      JSON.stringify({
        event: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: { id: "call_live_1", name: "lookup", args: { q: "x" } },
                    thoughtSignature: authenticSig,
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      }),
      JSON.stringify({ status: { type: "stream_ended" } }),
    ].join("\n") + "\n";

    zedLlmFetchMock.mockImplementationOnce(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(ndjson));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "application/x-ndjson" } }
      )
    );

    const executor = new ZedExecutor();
    const turn1 = await executor.execute({
      model: "gemini-4-argon",
      body: { model: "gemini-4-argon", stream: true, messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { _clientSessionId: "sess-auth-roundtrip" },
    });
    const sseText = await turn1.response.text();
    expect(sseText).toContain("call_live_1");

    const capturedTurn2 = {};
    captureZedFetch(capturedTurn2);
    await executor.execute({
      model: "gemini-4-argon",
      body: {
        model: "gemini-4-argon",
        stream: true,
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "call_live_1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } },
            ],
          },
          { role: "tool", tool_call_id: "call_live_1", content: "done" },
        ],
      },
      stream: true,
      credentials: { _clientSessionId: "sess-auth-roundtrip" },
    });

    const turn2Parts = capturedTurn2.body.provider_request.contents.flatMap((t) => t.parts || []);
    const callPart = turn2Parts.find((p) => p.functionCall?.name === "lookup");
    expect(callPart?.thoughtSignature).toBe(authenticSig);
  });
});
