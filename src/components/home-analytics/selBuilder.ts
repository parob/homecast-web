import { charLabel } from '@/components/automations/format';
import { disambiguateSeriesLabels, stripRoomPrefix } from '@/history/labels';
import type { AccessoryInfoEntry } from '@/history/categories';
import type { HistorySeriesInfo } from '@/lib/graphql/types';
import type { SeriesSel } from './types';

/** Series rows → chart selections with view-scoped disambiguated labels. */
export function buildSels(
  infos: HistorySeriesInfo[],
  accessoryInfo: Map<string, AccessoryInfoEntry>,
): SeriesSel[] {
  const items = infos.map(s => {
    const info = accessoryInfo.get(s.accessoryId.toUpperCase());
    return {
      key: `${s.accessoryId.toUpperCase()}|${s.characteristicType}`,
      room: info?.room ?? null,
      accessoryName: info?.name ?? s.accessoryId.slice(0, 8),
      charLabel: charLabel(s.characteristicType),
      series: s,
    };
  });
  const labels = disambiguateSeriesLabels(items);
  return items.map(({ key, series: s, room, accessoryName, charLabel: char }): SeriesSel => ({
    accessoryId: s.accessoryId,
    characteristicType: s.characteristicType,
    label: labels.get(key)?.short ?? key,
    fullLabel: labels.get(key)?.full,
    room,
    // The room is already the view's heading, so the cluster names the
    // accessory without repeating it.
    accessoryName: stripRoomPrefix(accessoryName, room),
    charLabel: char,
    unit: s.unit,
    kind: s.kind,
  }));
}

/**
 * Display name per accessory, unique WITHIN this view.
 *
 * The room gets stripped from an accessory's name because it usually repeats
 * the heading — but in a view spanning rooms the room is the only thing
 * telling six "Underfloor Heating" apart, and dropping it collapsed them into
 * one group of identical chips. So: strip the room when the short name is
 * unambiguous here, put it back when it isn't.
 */
export function accessoryDisplayNames(
  sels: Array<{ accessoryId: string; room?: string | null; accessoryName?: string }>,
): Map<string, string> {
  const shortOf = new Map<string, { short: string; room: string | null }>();
  for (const sel of sels) {
    const id = sel.accessoryId.toUpperCase();
    if (!shortOf.has(id)) {
      shortOf.set(id, { short: sel.accessoryName ?? id.slice(0, 8), room: sel.room ?? null });
    }
  }
  const owners = new Map<string, Set<string>>();
  for (const [id, { short }] of shortOf) {
    const set = owners.get(short) ?? new Set<string>();
    set.add(id);
    owners.set(short, set);
  }
  const out = new Map<string, string>();
  for (const [id, { short, room }] of shortOf) {
    const shared = (owners.get(short)?.size ?? 0) > 1;
    out.set(id, shared && room ? `${room} · ${short}` : short);
  }
  return out;
}

/**
 * Label for a view that already names the room — a room-scoped page or a
 * strip list under a room heading. Repeating "Kitchen ·" on every row there
 * spends the widest part of the label on the one word that never varies.
 */
export function labelWithoutRoom(sel: SeriesSel): string {
  return sel.accessoryName && sel.charLabel
    ? `${sel.accessoryName} · ${sel.charLabel}`
    : sel.label;
}

/**
 * The same label with the room put back in front — for a list that spans
 * rooms, where the room is the only thing telling one "Hue ambiance spot 3"
 * from another.
 *
 * Strip-then-re-add rather than trusting the raw name: HomeKit names are
 * inconsistent, so a bulb called "Living Hue spot 3" would otherwise read
 * "Living · Living Hue spot 3" while its neighbour reads correctly. Stripping
 * first makes both come out as "Living · Hue spot 3".
 */
export function labelWithRoom(sel: SeriesSel): string {
  const base = labelWithoutRoom(sel);
  return `${sel.room ?? 'Elsewhere'} · ${base}`;
}

/**
 * Fair cap: one series per room, then a second per room, … until `cap` —
 * a big home loses depth per room, never whole rooms.
 */
export function roundRobinByRoom(sels: SeriesSel[], cap: number): { taken: SeriesSel[]; dropped: number } {
  if (sels.length <= cap) return { taken: sels, dropped: 0 };
  const byRoom = new Map<string, SeriesSel[]>();
  for (const sel of sels) {
    const room = sel.room ?? 'Elsewhere';
    const list = byRoom.get(room) ?? [];
    list.push(sel);
    byRoom.set(room, list);
  }
  const taken: SeriesSel[] = [];
  let depth = 0;
  while (taken.length < cap) {
    let advanced = false;
    for (const list of byRoom.values()) {
      if (depth < list.length && taken.length < cap) {
        taken.push(list[depth]);
        advanced = true;
      }
    }
    if (!advanced) break;
    depth++;
  }
  return { taken, dropped: sels.length - taken.length };
}
