/**
 * No two relay actions may share a name.
 *
 * `automation.delete` already means "delete a HomeKit automation". A second
 * case with the same label — added for unloading a Homecast automation from the
 * engine — would be silently shadowed by the first, with no compiler or lint
 * error. The engine delete simply wouldn't happen.
 *
 * Cheap to assert, and the failure mode is invisible otherwise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = 'src/relay/local-handler.ts';

function caseLabels(): string[] {
  const src = readFileSync(SRC, 'utf8');
  return [...src.matchAll(/^\s*case '([^']+)':/gm)].map(m => m[1]);
}

describe('relay action dispatch', () => {
  it('has no duplicate case labels', () => {
    const seen = new Map<string, number>();
    for (const label of caseLabels()) {
      seen.set(label, (seen.get(label) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([l]) => l);

    expect(dupes).toEqual([]);
  });

  it('keeps the HomeKit and Homecast automation deletes distinct', () => {
    const labels = caseLabels();

    expect(labels).toContain('automation.delete');  // HomeKit-native
    expect(labels).toContain('automation.unload');  // Homecast engine
  });

  it('handles the config-sync actions the server routes to it', () => {
    const labels = caseLabels();

    for (const action of ['automation.sync', 'automation.sync_all', 'automation.unload']) {
      expect(labels).toContain(action);
    }
  });
});
