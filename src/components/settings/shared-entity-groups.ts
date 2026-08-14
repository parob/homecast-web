/**
 * Which home a shared item belongs to.
 *
 * The Sharing list used to show no home at all, so two rooms called "Kitchen"
 * in two homes rendered as two identical rows. `EntityAccess.home_id` was
 * always in the database — it just wasn't on the wire.
 *
 * Pure and separate from the component because the mapping has three traps
 * that are far easier to pin with a test than to spot in JSX:
 *
 *  1. For a `home` share the entity *is* the home, and `home_id` on those rows
 *     is normally null. Key off `entityId`.
 *  2. For `collection_group`, `home_id` holds a **collection id**, not a home
 *     (see `create_entity_access` server-side). Rendering it as a home would
 *     put a share under a heading that has nothing to do with it.
 *  3. Home ids disagree on case between sources — the relay and dashboard
 *     cache emit uppercase, the cloud resolves lowercase — so every comparison
 *     here is case-insensitive.
 */

import type { EntityType } from '@/lib/graphql/types';

export interface SharedEntityLike {
  entityType: EntityType;
  entityId: string;
  homeId?: string | null;
}

export interface HomeLike {
  id: string;
  name: string;
}

export interface SharedEntityGroup<T> {
  /** Uppercased home id, or null for the trailing "no home" group. */
  homeId: string | null;
  /** Resolved home name, or null when this is the "no home" group. */
  homeName: string | null;
  entities: T[];
}

/** Entity types that are never scoped to a single home. */
const HOMELESS_TYPES: ReadonlySet<string> = new Set(['collection', 'collection_group']);

/**
 * The home a share belongs to, uppercased — or null when it isn't home-scoped
 * or we can't tell.
 */
export function homeKeyForSharedEntity(entity: SharedEntityLike): string | null {
  if (entity.entityType === 'home') return entity.entityId.toUpperCase();
  if (HOMELESS_TYPES.has(entity.entityType)) return null;
  return entity.homeId ? entity.homeId.toUpperCase() : null;
}

/**
 * Group shares under their home, in the order `homes` lists them, with
 * everything unattributed in a single trailing group.
 *
 * A key that matches no known home also falls into that trailing group rather
 * than getting a heading of its own: with hc_ids and live UUIDs both in play,
 * unresolvable ids are expected, and a raw UUID is a worse heading than none.
 *
 * The same physical home can appear under more than one id (an owned copy and
 * a cloud-relay copy), so groups are merged by resolved *name*.
 */
export function groupSharedEntitiesByHome<T extends SharedEntityLike>(
  entities: T[],
  homes: HomeLike[],
): SharedEntityGroup<T>[] {
  const nameById = new Map<string, string>();
  for (const home of homes) nameById.set(home.id.toUpperCase(), home.name);

  // Keyed by home NAME so the duplicate-id case collapses to one heading.
  const byName = new Map<string, SharedEntityGroup<T>>();
  const orphans: T[] = [];

  for (const entity of entities) {
    const key = homeKeyForSharedEntity(entity);
    const name = key ? nameById.get(key) : undefined;
    if (!name) {
      orphans.push(entity);
      continue;
    }
    const existing = byName.get(name);
    if (existing) existing.entities.push(entity);
    else byName.set(name, { homeId: key, homeName: name, entities: [entity] });
  }

  // Follow the caller's home order, which is the order the rest of the app
  // shows homes in, rather than insertion order.
  const groups: SharedEntityGroup<T>[] = [];
  const emitted = new Set<string>();
  for (const home of homes) {
    const group = byName.get(home.name);
    if (group && !emitted.has(home.name)) {
      emitted.add(home.name);
      groups.push(group);
    }
  }
  // Anything grouped under a name not in `homes` (shouldn't happen, but the
  // map is keyed by name) still gets emitted rather than silently dropped.
  for (const [name, group] of byName) {
    if (!emitted.has(name)) groups.push(group);
  }

  if (orphans.length > 0) {
    groups.push({ homeId: null, homeName: null, entities: orphans });
  }
  return groups;
}
