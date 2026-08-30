import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOUD_SIGNUPS_PAUSED, CLOUD_RELAY_SIGNUPS_PAUSED } from '../cloud-relay-copy';

/**
 * The cloud-relay copy renders from several screens, and it has already drifted
 * once: homecast-web#31 rewrote the onboarding wording and the copies in
 * SetupState and HomesSection kept the old em-dashed version, so the same state
 * read two different ways depending on which screen you arrived from.
 *
 * These pin the two things that let that happen — the wording rule, and the
 * duplication — by reading the source rather than rendering. Both components
 * need a large amount of mocking to render, and the failure mode here is a
 * string literal sitting in the file, which the source shows directly.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every dash a reader sees as punctuation rather than a minus sign. */
const PROSE_DASH = /[–—]/;

/**
 * Strip comments and className strings: the project writes its comments in a
 * documentation voice that uses em dashes freely, and no user reads them.
 */
function userFacingLines(file: string): { line: number; text: string }[] {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  return src
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => {
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
      return true;
    })
    .map(({ line, text }) => ({ line, text: text.replace(/className=(["'`])(?:[^\\]*?)\1/g, '') }));
}

describe('cloud-relay copy', () => {
  it('has no em or en dashes in its own strings', () => {
    expect(CLOUD_SIGNUPS_PAUSED).not.toMatch(PROSE_DASH);
    expect(CLOUD_RELAY_SIGNUPS_PAUSED).not.toMatch(PROSE_DASH);
  });

  // The connect chooser in SetupState renders its own "Welcome to Homecast"
  // heading, so its copy sits beside the onboarding copy #31 rewrote.
  it('leaves no em or en dashes in SetupState, which is all user-facing copy', () => {
    const offenders = userFacingLines('components/SetupState.tsx')
      .filter(({ text }) => PROSE_DASH.test(text))
      .map(({ line, text }) => `${line}: ${text.trim()}`);
    expect(offenders, 'user-facing em dash in SetupState.tsx').toEqual([]);
  });

  it('states the paused-signups sentence once, not once per screen', () => {
    const literal = 'Signups paused';
    for (const file of ['components/SetupState.tsx', 'components/settings/HomesSection.tsx']) {
      const inlined = userFacingLines(file).filter(({ text }) => text.includes(literal));
      expect(inlined, `${file} should use the shared constant, not its own copy`).toEqual([]);
    }
  });
});
