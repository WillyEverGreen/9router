#!/usr/bin/env node
// Pre-build verification: the vision fix must be present.
// Exits 1 if any required component is missing.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

const checks = [
  {
    name: 'toolMedia concern exists',
    path: 'open-sse/translator/concerns/toolMedia.js',
    contains: ['hoistToolResultImages', 'Move image parts out of tool messages'],
  },
  {
    name: 'toolMedia imported in translator index',
    path: 'open-sse/translator/index.js',
    contains: ['hoistToolResultImages', 'from "./concerns/toolMedia.js"'],
  },
  {
    name: 'hoistToolResultImages called in translateRequest',
    path: 'open-sse/translator/index.js',
    contains: ['hoistToolResultImages(result)'],
    notContains: ['// hoistToolResultImages(result)'],
  },
  {
    name: 'Antigravity Claude image fix present',
    path: 'open-sse/translator/request/openai-to-gemini.js',
    contains: ['CLAUDE_BLOCK.IMAGE', 'inlineData', 'block.source.data'],
  },
  {
    name: 'vision fix tests exist',
    path: 'tests/unit/tool-media-hoist.test.js',
    contains: ['hoistToolResultImages', 'translateRequest'],
  },
];

let failed = false;

for (const check of checks) {
  const fullPath = join(root, check.path);
  
  if (!existsSync(fullPath)) {
    console.error(`❌ ${check.name}: file not found: ${check.path}`);
    failed = true;
    continue;
  }

  const content = readFileSync(fullPath, 'utf8');
  const missing = check.contains.filter((needle) => !content.includes(needle));

  if (missing.length > 0) {
    console.error(`❌ ${check.name}: missing required content in ${check.path}:`);
    for (const needle of missing) {
      console.error(`   - "${needle}"`);
    }
    failed = true;
  } else if (check.notContains) {
    const forbidden = check.notContains.filter((needle) => content.includes(needle));
    if (forbidden.length > 0) {
      console.error(`❌ ${check.name}: found forbidden pattern in ${check.path}:`);
      for (const needle of forbidden) {
        console.error(`   - "${needle}" (fix appears to be commented out or disabled)`);
      }
      failed = true;
    } else {
      console.log(`✅ ${check.name}`);
    }
  } else {
    console.log(`✅ ${check.name}`);
  }
}

if (failed) {
  console.error('\n❌ Vision fix verification failed. The fix may have been removed or broken.');
  console.error('   Required: toolMedia.js concern + hoistToolResultImages integration.');
  console.error('   See: commit a770bb68 "Add toolMedia concern for image-in-tool-result vision fix"');
  process.exit(1);
}

console.log('\n✅ Vision fix verification passed.');
process.exit(0);
