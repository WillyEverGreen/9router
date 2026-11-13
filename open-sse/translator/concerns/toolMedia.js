// Concern: images carried inside OpenAI `role: "tool"` messages.
//
// Agents (Hermes native vision, computer-use screenshots, MCP ImageContent) return
// pixels as a tool-result content array: [{type:"text"}, {type:"image_url"}].
// Only the Claude target reads that shape. Every other target silently loses it:
//   - OpenAI Responses/Codex stringifies the part, so the model reads base64 as text
//   - Gemini/Antigravity builds functionResponse from text only
//   - OpenAI-compatible upstreams treat the tool role as text-only
// The model then never receives the image and invents a description.
//
// Same remedy claude-to-openai.js applies: keep a text-only tool message and hand the
// image to the model in the user turn that follows the tool messages, tagged with
// the call it came from.
import { ROLE, OPENAI_BLOCK } from "../schema/index.js";

const isImagePart = (part) => part?.type === OPENAI_BLOCK.IMAGE_URL
  && (typeof part.image_url === "string" ? part.image_url : part.image_url?.url);

const NO_TEXT_PLACEHOLDER = "(image attached in the next message)";

/**
 * Move image parts out of tool messages, in-place on an OpenAI-format body.
 * Tool messages stay contiguous (strict upstreams require that) — the user turn
 * carrying the images is emitted after the last tool message of each run.
 * @returns {boolean} true when at least one image was relocated
 */
export function hoistToolResultImages(body) {
  if (!body || !Array.isArray(body.messages)) return false;

  const hasToolImages = body.messages.some(
    (m) => m?.role === ROLE.TOOL && Array.isArray(m.content) && m.content.some(isImagePart),
  );
  if (!hasToolImages) return false;

  const out = [];
  let pending = [];
  const flush = () => {
    if (pending.length) {
      out.push({ role: ROLE.USER, content: pending });
      pending = [];
    }
  };

  for (const msg of body.messages) {
    if (msg?.role !== ROLE.TOOL) {
      flush();
      out.push(msg);
      continue;
    }
    if (!Array.isArray(msg.content) || !msg.content.some(isImagePart)) {
      out.push(msg);
      continue;
    }
    const images = msg.content.filter(isImagePart);
    const text = msg.content
      .filter((p) => p?.type === OPENAI_BLOCK.TEXT && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
    out.push({ ...msg, content: text || NO_TEXT_PLACEHOLDER });
    pending.push({ type: OPENAI_BLOCK.TEXT, text: `[Image from tool result ${msg.tool_call_id}]` }, ...images);
  }
  flush();

  body.messages = out;
  return true;
}
