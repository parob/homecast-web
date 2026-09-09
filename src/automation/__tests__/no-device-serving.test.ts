/**
 * Invariant 6 of homecast-cloud#102: nothing on the automation-seeding path
 * may read this device's own serving state.
 *
 * Two engines fire every automation twice. The one rule that keeps two off
 * one home is "never start the automation engine in Local Mode", and the
 * cheapest way to break it is for something that decides whether to seed the
 * engine to consult the Local Mode controller — or the composed fact it feeds
 * — and reason its way around the rule. So the seeding path may not import
 * either. This test reads the files rather than the module graph so that a
 * dynamic `import()` is caught too.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..');

/** Everything that can start an engine, or runs inside one. */
const SEEDING_PATH = [
  'automation',
  'relay',
  'server/websocket.ts',
  'server/community-automation.ts',
];

/** The device-owned half of the fact, and the controller that owns it. */
const FORBIDDEN = [
  /['"][^'"]*local-mode-controller['"]/,
  /['"][^'"]*\/home-serving['"]/,
  /\bsetDeviceServing\b/,
  /\beffectiveServing\b/,
];

function* files(path: string): Generator<string> {
  const st = statSync(path);
  if (st.isFile()) { yield path; return; }
  for (const name of readdirSync(path)) {
    if (name === '__tests__' || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
    yield* files(join(path, name));
  }
}

describe('the seeding path never reads this device\'s own serving', () => {
  const offenders: string[] = [];
  for (const entry of SEEDING_PATH) {
    for (const file of files(join(SRC, entry))) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const re of FORBIDDEN) {
        if (re.test(text)) offenders.push(`${relative(SRC, file)}: ${re}`);
      }
    }
  }

  it('imports neither the Local Mode controller nor the composed fact', () => {
    expect(offenders).toEqual([]);
  });
});
