#!/usr/bin/env node
/**
 * Type-check ratchet.
 *
 * `npx tsc --noEmit` at the repo root checks NOTHING: tsconfig.json is a
 * solution-style config (`"files": []` + references), so the old CI step
 * passed for years while real type errors accumulated. This script runs the
 * REAL check (`-p tsconfig.app.json`) and compares against a committed
 * baseline of known errors:
 *
 *   - a NEW error (not in the baseline) fails the build
 *   - fixing errors prompts you to ratchet the baseline down
 *   - `node scripts/typecheck.mjs --update-baseline` rewrites the baseline
 *
 * Errors are keyed by file + TS code + message (no line numbers), so edits
 * that merely move an existing error don't churn the baseline.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'typecheck-baseline.json');
const update = process.argv.includes('--update-baseline');

let output = '';
try {
  output = execSync('npx tsc --noEmit -p tsconfig.app.json --pretty false', {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}

const errorRe = /^(.+?)\(\d+,\d+\): (error TS\d+): (.*)$/;
const current = new Map();
const rawLines = new Map();
for (const line of output.split('\n')) {
  const m = line.match(errorRe);
  if (!m) continue;
  const key = `${m[1]}|${m[2]}|${m[3]}`;
  current.set(key, (current.get(key) ?? 0) + 1);
  rawLines.set(key, line.trim());
}
const total = [...current.values()].reduce((a, b) => a + b, 0);

if (update) {
  const sorted = Object.fromEntries([...current.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`typecheck: baseline updated (${total} known error${total === 1 ? '' : 's'})`);
  process.exit(0);
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.error(`typecheck: missing ${path.basename(baselinePath)} — run with --update-baseline first`);
  process.exit(1);
}
const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);

const fresh = [];
for (const [key, count] of current) {
  const allowed = baseline[key] ?? 0;
  if (count > allowed) fresh.push(rawLines.get(key));
}

if (fresh.length > 0) {
  console.error(`typecheck: ${fresh.length} NEW type error${fresh.length === 1 ? '' : 's'} (not in baseline):\n`);
  for (const line of fresh.sort()) console.error(`  ${line}`);
  console.error('\nFix these — do not add them to the baseline.');
  process.exit(1);
}

if (total < baselineTotal) {
  console.log(
    `typecheck: OK — ${total}/${baselineTotal} baseline errors remain. ` +
    'You fixed some! Ratchet down with: node scripts/typecheck.mjs --update-baseline',
  );
} else {
  console.log(`typecheck: OK — no new errors (${total} known in baseline)`);
}
