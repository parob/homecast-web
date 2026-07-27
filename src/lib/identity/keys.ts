/**
 * Natural-key builders for Community-mode identity reconciliation — the
 * client-side twin of the server's homecast/identity/keys.py.
 *
 * A natural key is the *stable* identity of a HomeKit entity (what survives a
 * UUID rotation): serial numbers for accessories, name within home for rooms/
 * scenes/groups, serial fingerprint for homes.
 */

export function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

interface AccessoryLike {
  id?: string;
  name?: string;
  category?: string;
  roomName?: string;
  room?: string;
  serialNumber?: string;
  serial_number?: string;
  services?: Array<{ characteristics?: Array<{ characteristicType?: string; value?: unknown }> }>;
}

export function accessorySerial(acc: AccessoryLike | undefined): string | null {
  if (!acc) return null;
  if (acc.serialNumber) return String(acc.serialNumber);
  if (acc.serial_number) return String(acc.serial_number);
  for (const svc of acc.services ?? []) {
    for (const ch of svc.characteristics ?? []) {
      if (ch.characteristicType === 'serial_number' && ch.value != null) return String(ch.value);
    }
  }
  return null;
}

export function serialFingerprint(accessories: AccessoryLike[] | undefined): string | null {
  const serials = (accessories ?? [])
    .map(accessorySerial)
    .filter((s): s is string => !!s)
    .sort();
  return serials.length ? 'sn:' + serials.join('|') : null;
}

export function fingerprintSerials(naturalKey: string | null | undefined): Set<string> {
  if (!naturalKey || !naturalKey.startsWith('sn:')) return new Set();
  return new Set(naturalKey.slice(3).split('|').filter(Boolean));
}

/** Overlap ratio (intersection / smaller set) between two serial fingerprints. */
export function serialOverlap(a: string | null, b: string | null): number {
  const sa = fingerprintSerials(a);
  const sb = fingerprintSerials(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

export function homeNaturalKey(
  name: string,
  accessories?: AccessoryLike[],
  rooms?: Array<{ name?: string }>,
): string {
  const fp = serialFingerprint(accessories);
  if (fp) return fp;
  const roomNames = (rooms ?? [])
    .map((r) => normalizeName(r.name))
    .filter(Boolean)
    .sort();
  if (roomNames.length) return 'rooms:' + roomNames.join('|');
  return 'name:' + normalizeName(name);
}

export function roomNaturalKey(name: string): string {
  return 'name:' + normalizeName(name);
}

export function accessoryNaturalKey(acc: AccessoryLike): string {
  const serial = accessorySerial(acc);
  if (serial) return 'sn:' + serial;
  const name = normalizeName(acc.name);
  const category = normalizeName(acc.category);
  const room = normalizeName(acc.roomName ?? acc.room);
  return `nk:${name}|${category}|${room}`;
}

export function serviceGroupNaturalKey(name: string): string {
  return 'name:' + normalizeName(name);
}

export function sceneNaturalKey(name: string): string {
  return 'name:' + normalizeName(name);
}
