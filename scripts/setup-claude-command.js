const fs = require("fs");
const path = require("path");
const os = require("os");

const force = process.argv.includes("--force");
const dir = path.join(os.homedir(), ".claude", "commands");
fs.mkdirSync(dir, { recursive: true });

// 1. MODELS COMMAND (~/.claude/commands/models.md)
const modelsFile = path.join(dir, "models.md");
const modelsContent = `---
description: List all available 9Router models, quick shortcuts, and thinking effort levels across Zed, Kiro, Codex, and Antigravity
---

Output the complete, organized catalog of available 9Router models, effort commands, and shortcuts below directly to the user:

### ⚡ Quick Shortcuts (Switch via \`/model <name>\` or \`claude --model <name>\`)
| Shortcut Alias | Routed Model | Provider & Pool | Native Thinking |
|---|---|---|---|
| \`sonnet-5.5\` | Claude Sonnet 5.5 | Zed | ✅ Low / Med / High |
| \`sonnet-4.5\` | Claude Sonnet 4.5 | Kiro | ✅ Low / Med / High |
| \`deepseek\` | DeepSeek 3.2 | Kiro | ✅ High / Max |
| \`terra\` | GPT-5.6 Terra | Codex | ✅ Low / Med / High / Ultra |
| \`luna\` | GPT-6 Luna | Zed / Codex | ✅ Low / Med / High |
| \`qwen\` | Qwen3 Coder Next | Kiro | ✅ Low / Med / High |
| \`glm\` | GLM-5 | Kiro | ✅ Native Reasoning |
| \`daily\` | Gemini 3.8 Flash | Antigravity | ✅ Minimal / Low / High |
| \`plan\` | Claude Sonnet 4.5 Thinking | Kiro | ✅ High Thinking Budget |

---

### 🧠 Model Thinking & Effort Commands

You can set the reasoning effort level on **any** model by appending \`(<level>)\` or a token budget:

#### Syntax:
\`\`\`text
/model <alias>(<level>)
/model <alias>(<budget_tokens>)
\`\`\`

#### Supported Effort Levels:
- \`minimal\` (~512 tokens) - Quick sanity checks
- \`low\` (~1,024 tokens) - Fast responses, routine code edits
- \`medium\` (~8,192 tokens) - Standard debugging & feature coding
- \`high\` (~24,576 tokens) - Deep logic & complex architectural decisions
- \`xhigh\` (~32,768 tokens) - Exhaustive reasoning
- \`max\` (~128,000 tokens) - Maximum reasoning capacity
- \`ultra\` - Special Codex GPT-5.6 Terra mode
- \`none\` - Turn reasoning / thinking completely off

#### Examples:
- \`/model terra(high)\` — GPT-5.6 Terra with high reasoning
- \`/model terra(ultra)\` — GPT-5.6 Terra with ultra reasoning
- \`/model sonnet-4.5(high)\` — Claude Sonnet 4.5 with high thinking
- \`/model deepseek(high)\` — DeepSeek 3.2 with high reasoning
- \`/model daily(low)\` — Gemini 3.8 Flash with low thinking
- \`/model plan(32000)\` — Claude Sonnet 4.5 with 32,000 thinking tokens
- \`/model sonnet-4.5(none)\` — Turn thinking off for Sonnet 4.5

---

### 🌐 Direct Provider Models

#### 🔹 Zed Models (\`--model zd/<id>\`)
- \`zd/claude-sonnet-5-5\`, \`zd/claude-sonnet-5\`, \`zd/claude-sonnet-4-6\`, \`zd/claude-sonnet-4-5\`
- \`zd/claude-haiku-5-5\`, \`zd/claude-haiku-4-5\`
- \`zd/gemini-4-argon\`, \`zd/gemini-3.1-pro-preview\`, \`zd/gemini-3.8-flash\`
- \`zd/gpt-6.1-sol\`, \`zd/gpt-6-sol\`, \`zd/gpt-6-luna\`
- \`zd/gpt-5.6-terra\`, \`zd/gpt-5.6-luna\`, \`zd/gpt-5.5\`

#### 🔹 Kiro Pool (\`--model kr/<id>\`)
- \`kr/claude-sonnet-4.5\`, \`kr/claude-sonnet-4.5-thinking\`, \`kr/claude-sonnet-4.5-agentic\`
- \`kr/claude-haiku-4.5\`, \`kr/deepseek-3.2\`, \`kr/deepseek-3.2-thinking\`
- \`kr/qwen3-coder-next\`, \`kr/qwen3-coder-next-thinking\`
- \`kr/glm-5\`, \`kr/glm-5-thinking\`, \`kr/minimax-m2.5\`, \`kr/minimax-m2.1\`

#### 🔹 Codex Pool (\`--model cx/<id>\`)
- \`cx/gpt-5.6-terra\`, \`cx/gpt-5.6-terra[1m]\`, \`cx/gpt-5.6-terra-review\`
- \`cx/gpt-6-luna\`, \`cx/gpt-6-luna[1m]\`
- \`cx/gpt-5.5\`, \`cx/gpt-reserve\`

#### 🔹 Antigravity Pool (\`--model ag/<id>\`)
- \`ag/claude-opus-4-6-thinking\`, \`ag/claude-sonnet-4-6\`
- \`ag/gemini-3.8-flash\`, \`ag/gemini-3.8-flash-high\`, \`ag/gemini-3.8-flash-medium\`, \`ag/gemini-3.8-flash-low\`
- \`ag/gemini-3.7-flash-high\`, \`ag/gemini-3.6-flash-high\`, \`ag/gemini-3.1-pro-high\`

---

### 💡 Quick Switch Commands
- Type \`/model <alias>\` inside any active Claude CLI session (e.g. \`/model deepseek\`, \`/model terra(high)\`).
- Or launch from terminal: \`claude --model "<alias>(<effort>)"\`.
`;
if (fs.existsSync(modelsFile) && !force) {
  console.log("Skipped (exists, use --force to overwrite):", modelsFile);
} else {
  fs.writeFileSync(modelsFile, modelsContent, "utf8");
  console.log("Wrote:", modelsFile);
}

// 2. QUOTA COMMAND (~/.claude/commands/quota.md)
const quotaFile = path.join(dir, "quota.md");
const quotaContent = `---
description: Check remaining quotas, subscription allowances, account health, and reset timers in 9Router
---

Output the complete 9Router quota management summary and remaining balance guide to the user:

### 📊 9Router Quota & Remaining Balance Dashboard
View live remaining quotas, reset countdowns, and account pools directly in your browser:
👉 **http://localhost:20127/dashboard/quota**

---

### 🛡️ What 9Router Tracks Across Your Pools:

| Provider Pool | Accounts | What is Tracked | Reset Schedule |
|---|---|---|---|
| **Antigravity Pool** | per your connections | Daily requests & Gemini 3.8 / Pro limits | Daily midnight reset |
| **Kiro Pool** | per your connections | Account health, session validity, token reserves | Staggered 15m OIDC refresh |
| **Codex Pool** | per your connections | GPT-5.6 / GPT-6 credits & remaining quota | Monthly / Weekly cycle |
| **Zed / Claude** | Connected accounts | Usage tiers, input/output token limits | Rate-limit rolling window |

---

### 🚦 Quota Health & Visual Indicators:
- 🟢 **Green (>70% remaining)**: Healthy quota, full speed.
- 🟡 **Yellow (30% - 70% remaining)**: Normal usage.
- 🔴 **Red (<30% remaining)**: Low quota warning.

### ⚡ Automatic Quota Cliff Protection:
9Router automatically detects when any account drops below **5% quota** and **seamlessly switches to the next healthy account in the pool** or your fallback model without interrupting your Claude Code session.

---

### 💻 Terminal / CLI Quota Commands:
- To check Kiro account status & active account:
  \`\`\`bash
  kiro accounts
  \`\`\`
- To check proxy connection health:
  \`\`\`bash
  kiro status
  \`\`\`
- To view session token cost inside Claude Code:
  \`\`\`text
  /cost
  \`\`\`
`;
if (fs.existsSync(quotaFile) && !force) {
  console.log("Skipped (exists, use --force to overwrite):", quotaFile);
} else {
  fs.writeFileSync(quotaFile, quotaContent, "utf8");
  console.log("Wrote:", quotaFile);
}

// 3. HELP COMMAND (~/.claude/commands/help.md)
const helpFile = path.join(dir, "help.md");
const helpContent = `---
description: 9Router complete command reference, model switching, thinking effort levels, and quota management
---

Output the complete 9Router command cheat sheet and effort level guide directly to the user:

# 🚀 9Router & Claude Code Command Center

### 📌 Core Slash Commands:
| Command | Description |
|---|---|
| \`/models\` | Show all 40+ models, quick shortcuts, and provider pools |
| \`/quota\` | Check remaining quota, reset timers, and account pool status |
| \`/cost\` | Show tokens consumed and cost for the current session |
| \`/model <name>\` | Switch model (e.g. \`/model terra\`, \`/model deepseek\`) |
| \`/model <name>(<effort>)\` | Switch model with thinking effort (e.g. \`/model terra(high)\`) |
| \`/help\` | Show this 9Router command cheat sheet |

---

### 🧠 Model Effort & Thinking Controls:

Append \`(<level>)\` or token count to any model name:

| Effort Level | Budget Tokens | Recommended When |
|---|---|---|
| \`minimal\` | ~512 tokens | Quick sanity checks, syntax validation |
| \`low\` | ~1,024 tokens | Routine code edits, simple questions |
| \`medium\` | ~8,192 tokens | Standard feature development & debugging |
| \`high\` | ~24,576 tokens | Hard bugs, complex algorithms, system design |
| \`xhigh\` | ~32,768 tokens | Exhaustive reasoning & mathematical logic |
| \`max\` | ~128,000 tokens | Deepest reasoning possible across models |
| \`ultra\` | Max Context | Special mode for Codex GPT-5.6 Terra |
| \`none\` | 0 tokens | Turn reasoning completely off |

#### 💡 Effort Examples:
\`\`\`text
/model terra(high)          # GPT-5.6 Terra with high reasoning
/model terra(ultra)         # GPT-5.6 Terra with ultra reasoning
/model sonnet-4.5(high)     # Claude Sonnet 4.5 with high thinking
/model deepseek(high)       # DeepSeek 3.2 with deep reasoning
/model daily(low)           # Gemini 3.8 Flash with low thinking
/model plan(32000)          # Claude Sonnet 4.5 with 32k thinking tokens
/model sonnet-4.5(none)     # Turn thinking OFF for faster speed
\`\`\`

---

### ⚡ Top Model Shortcuts:
- \`sonnet-5.5\` -> Claude Sonnet 5.5 (Zed)
- \`sonnet-4.5\` -> Claude Sonnet 4.5 (Kiro)
- \`opus-4.6\` -> Claude Opus 4.6 Thinking (Antigravity)
- \`argon\` -> Gemini 4 Argon (Zed)
- \`deepseek\` -> DeepSeek 3.2
- \`terra\` -> GPT-5.6 Terra
- \`luna\` -> GPT-6 Luna (Zed / Codex)
- \`qwen\` -> Qwen3 Coder Next
- \`daily\` -> Gemini 3.8 Flash
- \`plan\` -> Claude Sonnet 4.5 Thinking (High Budget)

---

### 🌐 Web Dashboard Shortcuts:
- **Quota & Limits**: http://localhost:20127/dashboard/quota
- **Token Analytics**: http://localhost:20127/dashboard/usage
- **Token Saver (RTK)**: http://localhost:20127/dashboard/token-saver
`;
if (fs.existsSync(helpFile) && !force) {
  console.log("Skipped (exists, use --force to overwrite):", helpFile);
} else {
  fs.writeFileSync(helpFile, helpContent, "utf8");
  console.log("Wrote:", helpFile);
}

