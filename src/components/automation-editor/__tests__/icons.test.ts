/**
 * Guard for the editor's icon registry.
 *
 * BaseNode and NodePalette each kept their own hand-maintained icon map, and
 * they drifted: Repeat, Choose, Parallel, Set Variable and Stop were added to
 * the palette with no entry in either map, so all five silently fell back to
 * the same lightning bolt and were indistinguishable on the canvas — from each
 * other and from the Device Changed trigger.
 *
 * Nothing caught it because the icon maps had no tests. This asserts every node
 * definition resolves to its own icon, so adding a node type without an icon
 * fails the build rather than shipping a wall of identical glyphs.
 */

import { describe, it, expect } from 'vitest';
import { ALL_NODE_DEFINITIONS } from '../constants';
import { NODE_ICONS, getNodeIcon } from '../icons';

describe('node icon registry', () => {
  it('has an icon registered for every node definition', () => {
    const missing = ALL_NODE_DEFINITIONS
      .filter((def) => !NODE_ICONS[def.icon])
      .map((def) => `${def.type} -> ${def.icon}`);

    expect(missing).toEqual([]);
  });

  it('gives each node type a visually distinct icon', () => {
    const byIcon = new Map<string, string[]>();
    for (const def of ALL_NODE_DEFINITIONS) {
      byIcon.set(def.icon, [...(byIcon.get(def.icon) ?? []), def.type]);
    }

    const collisions = [...byIcon.entries()]
      .filter(([, types]) => types.length > 1)
      .map(([icon, types]) => `${icon}: ${types.join(', ')}`);

    expect(collisions).toEqual([]);
  });

  it('falls back to a known glyph for an unregistered name', () => {
    expect(getNodeIcon('NotARealIconName')).toBe(NODE_ICONS.Zap);
  });

  it('resolves the node types that previously fell through to the fallback', () => {
    for (const icon of ['Repeat', 'ListTree', 'Split', 'Variable', 'CircleStop']) {
      expect(getNodeIcon(icon)).not.toBe(NODE_ICONS.Zap);
    }
  });
});
