// Strict (serde-based) Claude-compatible upstreams reject tool_result blocks
// that omit `is_error`, so the translators always emit an explicit boolean.
import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const toolCall = {
  role: "assistant",
  content: null,
  tool_calls: [{ id: "call_1", type: "function", function: { name: "echo", arguments: "{}" } }],
};

function toolResultBlocks(out) {
  return out.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((b) => b.type === "tool_result");
}

describe("openai→claude: tool_result is_error", () => {
  it("role:tool messages get is_error:false and a string content", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", {
      messages: [
        { role: "user", content: "go" },
        toolCall,
        { role: "tool", tool_call_id: "call_1", content: "ok" },
      ],
    }, false);
    const [block] = toolResultBlocks(out);
    expect(block.is_error).toBe(false);
    expect(block.content).toBeDefined();
  });

  it("claude-style tool_result parts keep a true is_error and default missing to false", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", {
      messages: [
        { role: "user", content: "go" },
        toolCall,
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "call_1", content: "boom", is_error: true },
          { type: "tool_result", tool_use_id: "call_2", content: "fine" },
        ] },
      ],
    }, false);
    const blocks = toolResultBlocks(out);
    expect(blocks.find((b) => b.tool_use_id === "call_1").is_error).toBe(true);
    expect(blocks.find((b) => b.tool_use_id === "call_2").is_error).toBe(false);
  });
});
