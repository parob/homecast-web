// Human labels for the entities an automation node points at.
//
// The editor builds node subtitles in two places — once when loading a saved
// automation (serialization/automationToGraph) and again when the user edits a
// node (panels/NodeConfigPanel). They drifted, and the load-time one rendered
// raw ids: "Group 7468B625-D23… power_state". Both now resolve through here, so
// a fix lands in both paths at once.
//
// Names are resolved by id from live HomeKit data rather than persisted with
// the automation: the saved JSON only carries ids, and looking the name up
// keeps the label correct after the entity is renamed.

// Imported from the module rather than the widgets barrel: the barrel re-exports
// components that reach src/lib/config.ts, which touches `window` at import
// time and breaks any non-DOM consumer (the serialization tests run in node).
import { formatCharacteristicType } from '@/components/widgets/types';

export interface EntityNameSource {
  accessories?: { id: string; name: string }[];
  serviceGroups?: { id: string; name: string }[];
}

/** Last-resort label when we can't resolve a name — never show a bare UUID. */
function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

/**
 * Display name for whatever a node targets.
 *
 * `fallbackName` is the name captured in node config when the user picked the
 * entity in this session; it covers the window before HomeKit data arrives.
 */
export function resolveEntityName(
  source: EntityNameSource | undefined,
  ids: { accessoryId?: string; serviceGroupId?: string; fallbackName?: string },
): string {
  const { accessoryId, serviceGroupId, fallbackName } = ids;

  if (serviceGroupId) {
    const group = source?.serviceGroups?.find((g) => g.id === serviceGroupId);
    if (group?.name) return group.name;
    if (fallbackName) return fallbackName;
    return `Group ${shortId(serviceGroupId)}`;
  }

  if (accessoryId) {
    const acc = source?.accessories?.find((a) => a.id === accessoryId);
    if (acc?.name) return acc.name;
    if (fallbackName) return fallbackName;
    return shortId(accessoryId);
  }

  return fallbackName ?? '';
}

/** "power_state" -> "Power State", using the same formatter as the dashboard. */
export function characteristicLabel(type: string | undefined | null): string {
  return type ? formatCharacteristicType(type) : '';
}
