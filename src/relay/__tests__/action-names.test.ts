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

/**
 * Every relay action the app asks for must exist on the relay.
 *
 * The rename to "virtual accessory" left `useVirtualAccessories` calling
 * `automation.helper_states` and `automation.helper_operate` after the relay
 * had renamed both. Nothing failed loudly: the request fell through to a
 * handler that didn't know the action, and the dashboard reads any error from
 * that poll as "the engine is unreachable" — which disables every control on
 * every virtual accessory. A rename that misses one side is invisible, and this
 * is the third time it has cost a working feature.
 */
describe('actions the app requests exist on the relay', () => {
  const CALLERS = [
    'src/components/virtual-accessories/useVirtualAccessories.ts',
    'src/pages/Dashboard.tsx',
  ];

  it('every automation.* action requested is a case in local-handler', () => {
    const labels = new Set(caseLabels());
    const missing: string[] = [];

    for (const file of CALLERS) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/'(automation\.[a-z_]+)'/g)) {
        if (!labels.has(m[1])) missing.push(`${file}: ${m[1]}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
