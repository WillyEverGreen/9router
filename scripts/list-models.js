const ROUTER_URL = (process.env.NINE_ROUTER_URL || `http://127.0.0.1:${process.env.PORT || 20127}`).replace(/\/$/, "");
const HEADERS = process.env.NINE_ROUTER_API_KEY ? { Authorization: `Bearer ${process.env.NINE_ROUTER_API_KEY}` } : {};

async function run() {
  try {
    const res = await fetch(`${ROUTER_URL}/v1/models`, { headers: HEADERS });
    if (!res.ok) {
      console.error(`Failed to fetch models from 9Router (HTTP ${res.status}). Is 9Router running?`);
      return;
    }
    const { data } = await res.json();

    const categories = {
      "Quick Shortcuts (Use directly with `claude --model <name>`)": [],
      "Zed Models (Pass as `--model zd/<id>` or alias)": [],
      "Kiro Models (pass as `--model kr/<id>`)": [],
      "Codex Models (pass as `--model cx/<id>`)": [],
      "Antigravity Models (pass as `--model ag/<id>`)": []
    };

    for (const m of data) {
      const id = m.id;
      if (id.startsWith("zd/")) categories["Zed Models (Pass as `--model zd/<id>` or alias)"].push(id);
      else if (id.startsWith("kr/")) categories["Kiro Models (pass as `--model kr/<id>`)"]?.push(id);
      else if (id.startsWith("cx/")) categories["Codex Models (pass as `--model cx/<id>`)"]?.push(id);
      else if (id.startsWith("ag/")) categories["Antigravity Models (pass as `--model ag/<id>`)"]?.push(id);
      else if (!id.startsWith("auto/")) categories["Quick Shortcuts (Use directly with `claude --model <name>`)"]?.push(id);
    }

    console.log("===============================================================================");
    console.log("                     9ROUTER & CLAUDE CODE MODEL CATALOG                      ");
    console.log("===============================================================================\n");

    for (const [title, list] of Object.entries(categories)) {
      if (!list || list.length === 0) continue;
      console.log(`--- ${title} ---`);
      const formatted = list.map(item => `  • ${item.padEnd(35)}`);
      // Print in 2 columns
      for (let i = 0; i < formatted.length; i += 2) {
        console.log((formatted[i] || "") + (formatted[i + 1] || ""));
      }
      console.log("");
    }

    console.log("===============================================================================");
    console.log("  USAGE EXAMPLES in Claude Code CLI:");
    console.log("    claude --model sonnet-5.5    -> Claude Sonnet 5.5 via Zed");
    console.log("    claude --model deepseek      -> DeepSeek 3.2 via Kiro 20-pool");
    console.log("    claude --model terra         -> GPT-5.6 Terra via Codex");
    console.log("    claude --model qwen          -> Qwen3 Coder Next via Kiro");
    console.log("    claude --model glm           -> GLM-5 via Kiro");
    console.log("    claude --model opus          -> Claude Sonnet 4.5 Thinking via Kiro");
    console.log("===============================================================================\n");
  } catch (e) {
    console.error("Error connecting to 9Router:", e.message);
    console.error("Make sure 9Router is running (set PORT or NINE_ROUTER_URL if not on 20127).");
  }
}

run();
