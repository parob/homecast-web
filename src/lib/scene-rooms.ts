import type { HomeKitScene } from '@/lib/graphql/types';

type Room = { id: string; name: string };
type Accessory = { id: string; roomId?: string | null; roomName?: string | null };
const canonical = (id: string) => id.toLowerCase();

/** Missing or incomplete targets must never make a whole-home scene look room-local. */
export function inferSceneRoom(scene: HomeKitScene, accessories: Accessory[], rooms: Room[]): string | null {
  let actions: unknown = scene.actions;
  if (typeof actions === 'string') {
    try { actions = JSON.parse(actions); } catch { return null; }
  }
  if (!Array.isArray(actions) || !actions.length || actions.length < scene.actionCount) return null;
  const targets = new Map(accessories.map(a => [canonical(a.id), a]));
  const roomIds = new Set<string>();
  for (const action of actions) {
    if (!action || typeof action.accessoryId !== 'string') return null;
    const accessory = targets.get(canonical(action.accessoryId));
    if (!accessory) return null;
    const room = accessory.roomId
      ? rooms.find(r => canonical(r.id) === canonical(accessory.roomId!))
      : rooms.find(r => r.name === accessory.roomName);
    if (!room) return null;
    roomIds.add(room.id);
    if (roomIds.size > 1) return null;
  }
  return [...roomIds][0] ?? null;
}

export function sceneRoom(
  scene: HomeKitScene, accessories: Accessory[], rooms: Room[],
  placements?: Record<string, string | null>,
): string | null {
  const entry = Object.entries(placements ?? {}).find(([id]) => canonical(id) === canonical(scene.id));
  if (!entry) return inferSceneRoom(scene, accessories, rooms);
  // Deleted rooms fall back to the home instead of losing the scene.
  return entry[1] === null ? null : rooms.find(r => canonical(r.id) === canonical(entry[1]!))?.id ?? null;
}

/** Reordering the visible grid retains positions for hidden/offline cards. */
export function mergeVisibleOrder(saved: string[] | undefined, visible: string[]): string[] {
  const moving = new Set(visible);
  const next = [...new Set(visible)];
  const result = [...new Set(saved ?? [])].map(id => moving.has(id) ? next.shift()! : id);
  return [...result, ...next];
}
