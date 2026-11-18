# Fork patches

Changes carried on `WillyEverGreen/9router` that upstream (`decolua/9router`) does not have.
Run `node scripts/verify-fork-patches.mjs` after every upstream merge and every rebuild.

## 1. Images returned inside tool results reach non-Claude upstreams

**Problem.** Agents such as Hermes (native vision) return pixels as a tool-result content
array. Only the Claude target read it. Codex stringified the base64 into text, Gemini and
Antigravity built `functionResponse` from text only, and OpenAI-compatible upstreams treat
the `tool` role as text-only. The model never received the image and invented a description.

**Fix.** Move image parts out of `role:"tool"` messages into the user turn that follows.

| File | Change |
|---|---|
| `open-sse/translator/concerns/toolMedia.js` (new) | `hoistToolResultImages(body)` |
| `open-sse/translator/index.js` | import + one call before `ensureToolCallIds`, only when source is OpenAI and target is not Claude (7 lines) |
| `open-sse/translator/request/openai-to-gemini.js` | `CLAUDE_BLOCK.IMAGE` branch in `wrapInCloudCodeEnvelopeForClaude` so the Antigravity Claude route stops dropping images (8 lines) |
| `tests/unit/tool-media-hoist.test.js` (new) | 8 tests |

**If an upstream merge conflicts in `index.js` or `openai-to-gemini.js`:** keep upstream's
version of the surrounding code and re-apply the lines above. The verifier tells you if
anything is missing.

## 2. Deployment: the gateway runs from `cli\app`, not from source

The running gateway is the supervisor in `C:\tools\9router`, pointed by
`C:\tools\9router\config.json` at `<repo>\cli\app`. That folder is a **generated, gitignored**
build. Editing `open-sse/` changes nothing until it is rebuilt.

- Update with `C:\tools\scripts\update-9router.ps1` (rebuilds `cli\app` from this repo).
- Do **not** use `-Npm` or `npm i -g 9router`. The npm package has none of these patches.
- If `config.json` is lost, `supervisor.cjs` falls back to the global npm package, which also
  has none of them. Restore `appDir` to `<repo>\cli\app`.
- `update-9router.ps1` now runs the verifier against the rebuilt bundle and warns if the fix
  is missing.

## 3. Hermes Desktop settings (outside this repo)

In `%LOCALAPPDATA%\Hermes\config.yaml`:

```yaml
agent:
  image_input_mode: native
model:
  supports_vision: true
```

Without them Hermes pre-describes images with a lossy text tool instead of sending pixels.
Check with `hermes config get agent.image_input_mode` and `hermes config get model.supports_vision`.
