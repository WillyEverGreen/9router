import { describe, it, expect } from "vitest";
import { hoistToolResultImages } from "../../open-sse/translator/concerns/toolMedia.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const DATA_URL = "data:image/png;base64,AAAA";

const withToolImage = () => ({
  model: "plan",
  messages: [
    { role: "user", content: "load it" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "vision_analyze", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", content: [
      { type: "text", text: "Image loaded." },
      { type: "image_url", image_url: { url: DATA_URL } },
    ] },
  ],
});

describe("hoistToolResultImages", () => {
  it("moves the image to a user turn and leaves a text-only tool message", () => {
    const body = withToolImage();
    expect(hoistToolResultImages(body)).toBe(true);
    const [, , tool, user] = body.messages;
    expect(tool).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "Image loaded." });
    expect(user.role).toBe("user");
    expect(user.content.some((p) => p.type === "image_url" && p.image_url.url === DATA_URL)).toBe(true);
    expect(user.content[0].text).toContain("call_1");
  });

  it("uses a placeholder when the tool message had no text", () => {
    const body = withToolImage();
    body.messages[2].content = [{ type: "image_url", image_url: { url: DATA_URL } }];
    hoistToolResultImages(body);
    expect(typeof body.messages[2].content).toBe("string");
    expect(body.messages[2].content.length).toBeGreaterThan(0);
  });

  it("keeps parallel tool messages contiguous and emits one user turn after them", () => {
    const body = withToolImage();
    body.messages.push({ role: "tool", tool_call_id: "call_2", content: [{ type: "image_url", image_url: { url: DATA_URL } }] });
    hoistToolResultImages(body);
    const roles = body.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "tool", "user"]);
    expect(body.messages[4].content.filter((p) => p.type === "image_url")).toHaveLength(2);
  });

  it("is a no-op for string tool results and image-free bodies", () => {
    const body = { messages: [{ role: "user", content: "hi" }, { role: "tool", tool_call_id: "c", content: "ok" }] };
    const before = JSON.stringify(body);
    expect(hoistToolResultImages(body)).toBe(false);
    expect(JSON.stringify(body)).toBe(before);
    expect(hoistToolResultImages(null)).toBe(false);
  });
});

describe("antigravity claude route keeps images", () => {
  it("openai user image -> inlineData on a claude model", () => {
    const body = { model: "x", messages: [{ role: "user", content: [
      { type: "text", text: "what is this" },
      { type: "image_url", image_url: { url: DATA_URL } },
    ] }] };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "claude-opus-4-6-thinking", body, true, null, "antigravity");
    const parts = out.request.contents.flatMap((c) => c.parts);
    expect(parts.some((p) => p.inlineData?.data === "AAAA" && p.inlineData?.mime_type === "image/png")).toBe(true);
  });

  it("an image returned by a tool still reaches a claude model", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "claude-opus-4-6-thinking", withToolImage(), true, null, "antigravity");
    const parts = out.request.contents.flatMap((c) => c.parts);
    expect(parts.some((p) => p.inlineData?.data === "AAAA")).toBe(true);
  });
});

describe("translateRequest tool images", () => {
  it("openai -> openai-responses: the image reaches the model as input_image", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-x", withToolImage(), true, null, "codex");
    const images = out.input.flatMap((i) => (Array.isArray(i.content) ? i.content : [])).filter((c) => c.type === "input_image");
    expect(images).toHaveLength(1);
    const output = out.input.find((i) => i.type === "function_call_output");
    expect(output.output).not.toContain("base64");
  });

  it("openai -> claude: tool_result keeps its native image block (not hoisted)", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-x", withToolImage(), true, null, "claude");
    const toolResult = out.messages.flatMap((m) => m.content).find((b) => b.type === "tool_result");
    expect(toolResult.content.some((c) => c.type === "image")).toBe(true);
  });
});
