import { describe, it, expect } from 'vitest';
import { buildScopeTree, scopeCrumbs } from '../scope';
import type { AccessoryInfoEntry } from '@/history/categories';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

const series = (accessoryId: string, characteristicType: string, enabled = true) => ({
  accessoryId, characteristicType, enabled, kind: 'numeric', unit: '°',
} as unknown as HistorySeriesInfo);

const info = (entries: Array<[string, string, string | null]>) =>
  new Map<string, AccessoryInfoEntry>(
    entries.map(([id, name, room]) => [id, { name, room } as AccessoryInfoEntry]),
  );

describe('buildScopeTree', () => {
  const accessoryInfo = info([
    ['A1', 'Underfloor Heating', 'Bedroom 2'],
    ['A2', 'Ensuite Radiator', 'Bedroom 2'],
    ['A3', 'Kitchen Sensor', 'Kitchen'],
    ['A4', 'Holiday Mode', null],
  ]);

  it('groups accessories under their rooms, alphabetically', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature'), series('A2', 'current_temperature'), series('A3', 'current_temperature')],
      accessoryInfo, [],
    );
    expect(tree.rooms.map(r => r.label)).toEqual(['Bedroom 2', 'Kitchen']);
    expect(tree.rooms[0].accessories.map(a => a.name)).toEqual(['Ensuite Radiator', 'Underfloor Heating']);
  });

  it('counts each accessory’s recorded characteristics', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature'), series('A1', 'relative_humidity'), series('A1', 'power_state')],
      accessoryInfo, [],
    );
    expect(tree.rooms[0].accessories[0].seriesCount).toBe(3);
    expect(tree.accessoryCount).toBe(1);
  });

  it('leaves out accessories with nothing recorded — the tree only shows places you can go', () => {
    const tree = buildScopeTree([series('A1', 'current_temperature')], accessoryInfo, []);
    expect(tree.accessoryCount).toBe(1);
    expect(tree.rooms.flatMap(r => r.accessories).map(a => a.id)).toEqual(['A1']);
  });

  it('ignores series whose recording is switched off', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature', false), series('A3', 'current_temperature')],
      accessoryInfo, [],
    );
    expect(tree.rooms.map(r => r.label)).toEqual(['Kitchen']);
  });

  it('puts the roomless bucket last, not first', () => {
    const tree = buildScopeTree(
      [series('A4', 'virtual_switch'), series('A3', 'current_temperature')],
      accessoryInfo, [],
    );
    expect(tree.rooms.map(r => r.label)).toEqual(['Kitchen', 'Elsewhere']);
    expect(tree.rooms[1].room).toBeNull();
  });

  it('puts a group under its room, and stops listing its members separately', () => {
    // A room of nine downlights is one row, not nine — the same rule the
    // activity strips follow.
    const tree = buildScopeTree(
      [series('A1', 'current_temperature'), series('A2', 'current_temperature'), series('A3', 'current_temperature')],
      accessoryInfo,
      [{ id: 'g1', name: 'Heating', memberIds: ['A1', 'A2'] }],
    );
    const bedroom = tree.rooms.find(r => r.label === 'Bedroom 2')!;
    expect(bedroom.groups.map(g => g.name)).toEqual(['Heating']);
    expect(bedroom.groups[0].members.map(m => m.name)).toEqual(['Ensuite Radiator', 'Underfloor Heating']);
    expect(bedroom.accessories).toEqual([]); // both are reachable via the group
    expect(bedroom.total).toBe(2);
    expect(tree.groups).toEqual([]); // it belongs to a room, not to the home
  });

  it('names a group the way it names an accessory — no room said twice', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature'), series('A2', 'current_temperature')],
      accessoryInfo,
      [{ id: 'g1', name: 'Bedroom 2 Heating', memberIds: ['A1', 'A2'] }],
    );
    expect(tree.rooms.find(r => r.label === 'Bedroom 2')!.groups[0].name).toBe('Heating');
  });

  it('leaves a cross-room group its whole name — it has no room to drop', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature'), series('A3', 'current_temperature')],
      accessoryInfo,
      [{ id: 'g1', name: 'Bedroom 2 Heating', memberIds: ['A1', 'A3'] }],
    );
    expect(tree.groups[0].name).toBe('Bedroom 2 Heating');
  });

  it('keeps a group that spans rooms at the top level', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature'), series('A3', 'current_temperature')],
      accessoryInfo,
      [{ id: 'g1', name: 'All Heating', memberIds: ['A1', 'A3'] }],
    );
    expect(tree.groups.map(g => g.name)).toEqual(['All Heating']);
    // …and its members still appear under their own rooms.
    expect(tree.rooms.flatMap(r => r.accessories.map(a => a.id)).sort()).toEqual(['A1', 'A3']);
  });

  it('ignores a group with fewer than two recorded members', () => {
    // One member is just that accessory with an extra layer to open.
    const tree = buildScopeTree(
      [series('A1', 'current_temperature')],
      accessoryInfo,
      [{ id: 'g1', name: 'Heating', memberIds: ['A1', 'A2'] }],
    );
    expect(tree.groups).toEqual([]);
    expect(tree.rooms[0].groups).toEqual([]);
    expect(tree.rooms[0].accessories.map(a => a.id)).toEqual(['A1']);
  });

  it('follows the main navigation’s room order, roomless still last', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature'), series('A3', 'current_temperature'), series('A4', 'virtual_switch')],
      accessoryInfo, [], ['Kitchen', 'Bedroom 2'],
    );
    expect(tree.rooms.map(r => r.label)).toEqual(['Kitchen', 'Bedroom 2', 'Elsewhere']);
  });

  it('falls back to alphabetical for rooms that order does not name', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature'), series('A3', 'current_temperature')],
      accessoryInfo, [], ['Kitchen'],
    );
    expect(tree.rooms.map(r => r.label)).toEqual(['Kitchen', 'Bedroom 2']);
  });

  it('names accessories the way the dashboard does', () => {
    const tree = buildScopeTree(
      [series('A1', 'current_temperature')],
      info([['A1', 'Bedroom 2 Underfloor Heating', 'Bedroom 2']]),
      [],
    );
    expect(tree.rooms[0].accessories[0].name).toBe('Underfloor Heating');
  });
});

describe('scopeCrumbs', () => {
  const accessoryInfo = info([['A1', 'Underfloor Heating', 'Bedroom 2']]);
  const groups = [{ id: 'g1', name: 'All Lights' }];

  it('walks home → room → accessory, each step navigable', () => {
    const crumbs = scopeCrumbs({ level: 'accessory', accessoryId: 'A1' }, 'George Street', accessoryInfo, groups);
    expect(crumbs.map(c => c.label)).toEqual(['George Street', 'Bedroom 2', 'Underfloor Heating']);
    expect(crumbs[1].scope).toEqual({ level: 'room', room: 'Bedroom 2' });
  });

  it('skips the room step for a roomless accessory', () => {
    const crumbs = scopeCrumbs(
      { level: 'accessory', accessoryId: 'A9' }, 'George Street',
      info([['A9', 'Holiday Mode', null]]), groups,
    );
    expect(crumbs.map(c => c.label)).toEqual(['George Street', 'Holiday Mode']);
  });

  it('names a group', () => {
    expect(scopeCrumbs({ level: 'group', groupId: 'g1' }, 'H', accessoryInfo, groups).map(c => c.label))
      .toEqual(['H', 'All Lights']);
  });
});
