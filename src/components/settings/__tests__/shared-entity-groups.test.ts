import { describe, it, expect } from 'vitest';
import {
  homeKeyForSharedEntity,
  groupSharedEntitiesByHome,
  type SharedEntityLike,
} from '../shared-entity-groups';

const HOMES = [
  { id: 'AAAAAAAA-0000-0000-0000-000000000001', name: 'Beach House' },
  { id: 'BBBBBBBB-0000-0000-0000-000000000002', name: 'Flat' },
];

const entity = (over: Partial<SharedEntityLike> & Pick<SharedEntityLike, 'entityType'>): SharedEntityLike => ({
  entityId: 'ENTITY-1',
  homeId: null,
  ...over,
});

describe('homeKeyForSharedEntity', () => {
  it('uses entityId for a home share — the entity IS the home, and its home_id is null', () => {
    expect(homeKeyForSharedEntity(entity({
      entityType: 'home',
      entityId: HOMES[0].id,
      homeId: null,
    }))).toBe(HOMES[0].id.toUpperCase());
  });

  it('never treats collection_group as home-scoped — its home_id is a collection id', () => {
    expect(homeKeyForSharedEntity(entity({
      entityType: 'collection_group',
      homeId: 'CCCCCCCC-0000-0000-0000-000000000003',
    }))).toBeNull();
  });

  it('treats a collection as homeless — collections span homes', () => {
    expect(homeKeyForSharedEntity(entity({ entityType: 'collection' }))).toBeNull();
  });

  it('uses homeId for rooms, accessories and groups, uppercased', () => {
    for (const entityType of ['room', 'accessory', 'accessory_group', 'room_group'] as const) {
      expect(homeKeyForSharedEntity(entity({
        entityType,
        homeId: HOMES[0].id.toLowerCase(),
      }))).toBe(HOMES[0].id.toUpperCase());
    }
  });

  it('returns null for a legacy row that never recorded a home', () => {
    expect(homeKeyForSharedEntity(entity({ entityType: 'room', homeId: null }))).toBeNull();
  });
});

describe('groupSharedEntitiesByHome', () => {
  it('matches case-insensitively — the wire and the cache disagree on case', () => {
    const groups = groupSharedEntitiesByHome(
      [entity({ entityType: 'room', entityId: 'R1', homeId: HOMES[0].id.toLowerCase() })],
      HOMES,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].homeName).toBe('Beach House');
  });

  it('orders groups by the homes array and always puts the no-home group last', () => {
    const groups = groupSharedEntitiesByHome(
      [
        entity({ entityType: 'collection', entityId: 'C1' }),
        entity({ entityType: 'room', entityId: 'R2', homeId: HOMES[1].id }),
        entity({ entityType: 'room', entityId: 'R1', homeId: HOMES[0].id }),
      ],
      HOMES,
    );
    expect(groups.map(g => g.homeName)).toEqual(['Beach House', 'Flat', null]);
  });

  it('omits homes that have nothing shared', () => {
    const groups = groupSharedEntitiesByHome(
      [entity({ entityType: 'room', entityId: 'R1', homeId: HOMES[1].id })],
      HOMES,
    );
    expect(groups.map(g => g.homeName)).toEqual(['Flat']);
  });

  it('drops an unresolvable homeId into the no-home group, not a UUID heading', () => {
    const groups = groupSharedEntitiesByHome(
      [entity({ entityType: 'room', entityId: 'R1', homeId: 'DDDDDDDD-0000-0000-0000-00000000000D' })],
      HOMES,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].homeName).toBeNull();
    expect(groups[0].entities).toHaveLength(1);
  });

  it('merges the owned and cloud-relay copies of one home into a single heading', () => {
    // The same physical home really does surface under two ids.
    const duplicated = [...HOMES, { id: 'EEEEEEEE-0000-0000-0000-00000000000E', name: 'Beach House' }];
    const groups = groupSharedEntitiesByHome(
      [
        entity({ entityType: 'room', entityId: 'R1', homeId: HOMES[0].id }),
        entity({ entityType: 'room', entityId: 'R2', homeId: 'EEEEEEEE-0000-0000-0000-00000000000E' }),
      ],
      duplicated,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].homeName).toBe('Beach House');
    expect(groups[0].entities.map(e => e.entityId)).toEqual(['R1', 'R2']);
  });

  it('returns everything in one no-home group before the server reports homeId', () => {
    // The pre-deploy state: the field is absent, so the list must degrade to
    // exactly what it looked like before — one group, which renders unheaded.
    const groups = groupSharedEntitiesByHome(
      [
        entity({ entityType: 'room', entityId: 'R1' }),
        entity({ entityType: 'accessory', entityId: 'A1' }),
      ],
      HOMES,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].homeName).toBeNull();
  });

  it('handles an empty list', () => {
    expect(groupSharedEntitiesByHome([], HOMES)).toEqual([]);
  });
});
