#!/usr/bin/env node
/**
 * Runs unit tests via tests/package.json while preserving targeted file filters
 * passed after `npm run test:unit -- <args>`.
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const hasTarget = args.some(
  (arg) =>
    !arg.startsWith("-") &&
    (arg === "unit" ||
      arg.startsWith("unit/") ||
      arg.startsWith("unit\\") ||
      arg.includes(".test."))
);

const finalArgs = ["--prefix", "tests", "test", "--", ...args];
if (!hasTarget) {
  finalArgs.push("unit/");
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCmd, finalArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);

