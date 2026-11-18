// Fails loudly when a fork-only patch has been lost (bad merge, npm reinstall, stale bundle).
//
//   node scripts/verify-fork-patches.mjs                  source checks + behavioural tests
//   node scripts/verify-fork-patches.mjs --bundle <dir>   also check a built cli/app bundle
//   node scripts/verify-fork-patches.mjs --skip-tests     source (+bundle) checks only
//
// Exit codes: 0 all good, 1 a patch is missing or broken.
// Patches are described in FORK_PATCHES.md.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const skipTests = args.includes("--skip-tests");
const bundleIdx = args.indexOf("--bundle");
const bundleDir = bundleIdx >= 0 ? args[bundleIdx + 1] : null;

const failures = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => { failures.push(msg); console.log(`  FAIL  ${msg}`); };

const read = (rel) => {
  const file = path.join(root, rel);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};

// Each patch: a file and the exact fragments that must still be present in it.
const SOURCE_CHECKS = [
  {
    patch: "tool-result images reach non-Claude upstreams",
    file: "open-sse/translator/concerns/toolMedia.js",
    must: ["export function hoistToolResultImages", "image attached in the next message"],
  },
  {
    patch: "tool-result images reach non-Claude upstreams",
    file: "open-sse/translator/index.js",
    must: [
      'import { hoistToolResultImages } from "./concerns/toolMedia.js"',
      "hoistToolResultImages(result)",
    ],
  },
  {
    patch: "Antigravity Claude route keeps image blocks",
    file: "open-sse/translator/request/openai-to-gemini.js",
    must: ["block.type === CLAUDE_BLOCK.IMAGE", "inlineData: { mime_type: block.source.media_type"],
  },
];

console.log("Source checks");
for (const { patch, file, must } of SOURCE_CHECKS) {
  const text = read(file);
  if (text === null) { bad(`${file} is missing (${patch})`); continue; }
  const missing = must.filter((frag) => !text.includes(frag));
  if (missing.length) bad(`${file} lost: ${missing.join(" | ")} (${patch})`);
  else ok(`${file} (${patch})`);
}

// The hoist must run BEFORE translation and only for non-Claude targets.
const indexSrc = read("open-sse/translator/index.js");
if (indexSrc) {
  const call = indexSrc.indexOf("hoistToolResultImages(result)");
  const translate = indexSrc.indexOf("requestRegistry.get(`${sourceFormat}:${targetFormat}`)");
  if (call >= 0 && translate >= 0 && call < translate) ok("hoist runs before the translator lookup");
  else bad("hoistToolResultImages no longer runs before translation in translator/index.js");
  if (/targetFormat\s*!==\s*FORMATS\.CLAUDE[\s\S]{0,80}hoistToolResultImages/.test(indexSrc)) ok("hoist is skipped for Claude targets");
  else bad("hoist is no longer limited to non-Claude targets (would break native tool_result images)");
}

if (bundleDir) {
  console.log(`Bundle check: ${bundleDir}`);
  const serverDir = path.join(bundleDir, ".next-cli-build", "server");
  if (!existsSync(serverDir)) {
    bad(`no server build under ${serverDir}`);
  } else {
    const MARKER = "image attached in the next message";
    let found = false;
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (found) return;
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (name.endsWith(".js") && readFileSync(full, "utf8").includes(MARKER)) found = true;
      }
    };
    walk(serverDir);
    if (found) ok("built bundle contains the tool-image fix");
    else bad("built bundle does NOT contain the tool-image fix - rebuild from this repo (cli/scripts/build-cli.js), not from npm");
  }
}

if (!skipTests) {
  console.log("Behavioural tests");
  const vitest = path.join(root, "tests", "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
  if (!existsSync(vitest)) {
    bad("vitest is not installed (cd tests && npm install) - cannot run behavioural check");
  } else {
    const run = spawnSync(`"${vitest}" run unit/tool-media-hoist.test.js`, {
      cwd: path.join(root, "tests"), shell: true, encoding: "utf8",
    });
    if (run.status === 0) ok("unit/tool-media-hoist.test.js passes");
    else { bad("unit/tool-media-hoist.test.js fails"); console.log((run.stdout || "").split("\n").slice(-25).join("\n")); }
  }
}

console.log("");
if (failures.length) {
  console.log(`FORK PATCH CHECK FAILED (${failures.length}). See FORK_PATCHES.md for how to restore.`);
  process.exit(1);
}
console.log("All fork patches present.");
