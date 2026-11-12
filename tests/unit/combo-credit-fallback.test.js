import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

describe("combo credit fallback", () => {
  it.each([
    ["You have insufficient credits to make this request.", true],
    ["Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.", true],
    // Per #5057 (combo-request-scoped-fallback.test.js), a generic 400 is request-scoped
    // so the combo advances to the next member instead of stopping early.
    ["Bad request", true],
  ])("routes a 400 response correctly: %s", async (message, shouldContinue) => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const failure = Response.json({ error: { message } }, { status: 400 });
    const success = Response.json({ choices: [{ message: { content: "Hello" } }] });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);

    const response = await handleComboChat({
      body, models, handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback", comboStrategy: "fallback",
    });

    expect(response).toBe(shouldContinue ? success : failure);
    expect(handleSingleModel.mock.calls).toEqual(
      (shouldContinue ? models : models.slice(0, 1)).map((model) => [body, model])
    );
  });

  it("does not fall through on a non-retryable empty content_filter stream response", async () => {
    const body = { stream: true, messages: [{ role: "user", content: "Hello" }] };
    const models = ["cmc/deepseek/deepseek-v4-pro", "mistral/mistral-medium-latest"];
    const encoder = new TextEncoder();
    const sse = 'data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n';
    const contentFilterResponse = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode(sse));
          c.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
    const secondResponse = Response.json({ choices: [{ message: { content: "Fallback" } }] });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(contentFilterResponse)
      .mockResolvedValueOnce(secondResponse);

    const response = await handleComboChat({
      body,
      models,
      handleSingleModel,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "credit-fallback-stop",
      comboStrategy: "fallback",
    });

    expect(response.status).toBe(200);
    expect(handleSingleModel.mock.calls).toEqual([[body, models[0]]]);
  });
});
