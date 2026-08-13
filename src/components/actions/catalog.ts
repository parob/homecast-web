/**
 * The Actions catalog — preprogrammed, zero-configuration shortcuts derived
 * from what a home actually contains.
 *
 * Pure: no React, no Apollo, no network. Everything here is a function of the
 * accessory list, which is what makes the pill instant (it never fetches) and
 * the whole thing unit-testable.
 */

import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { getCharacteristic, getPrimaryServiceType, hasServiceType } from '@/components/widgets/types';
import { usesStandardPositionLogic, fromOpenness, toOpenness } from '@/components/widgets/shared/coveringStatus';
import { SECURITY_STATE, normalizeSecurityState, isSecurityArmed } from '@/components/widgets/shared/securityState';
import { canonicalCharacteristic } from '@/lib/characteristic-aliases';
import type { HomeActionId } from '@/lib/summary-sections';

export type { HomeActionId };

/** Key into the icon map in ActionsSection — keeps this module free of lucide imports. */
export type HomeActionIcon =
  | 'lightbulb' | 'blinds' | 'lock' | 'fan' | 'outlet' | 'thermostat' | 'shield' | 'power';

export interface HomeActionWrite {
  accessoryId: string;
  /** Canonical name — what goes on the wire. */
  characteristicType: string;
  /** The name this accessory actually reports ('on' | 'active' | …), when it differs. */
  reportedCharacteristicType: string;
  value: boolean | number;
  /** Current value, so a failed write can be reverted in the cache. */
  previousValue: unknown;
}

/**
 * An ordered stage of an action. Every action in this catalog has exactly one.
 *
 * The shape exists so composite shortcuts ("Good night" = lights off, pause,
 * lock up, close blinds) become a data-only addition later without touching
 * the executor.
 */
export interface HomeActionStep {
  writes: HomeActionWrite[];
  delayAfterMs?: number;
}

export interface HomeAction {
  id: HomeActionId;
  /** Names the direction the next press goes: "Turn all lights off". */
  label: string;
  /** What the label elides: "8 of 12 on", "All locked". */
  subtitle: string;
  icon: HomeActionIcon;
  /** Feeds getIconColor() so the chip matches the matching accessory widget. */
  serviceType: string;
  /** How many accessories this press would write to. */
  targetCount: number;
  /** True when the next press turns things on / opens / arms. */
  turningOn: boolean;
  /** Nothing left to do — render dimmed; the subtitle says why. */
  disabled: boolean;
  /** Present ⇒ confirm before running, using this as the dialog question. */
  confirm?: string;
  steps: HomeActionStep[];
}

/** Fixed display order, and the order the settings checklist uses. */
export const HOME_ACTION_ORDER: HomeActionId[] = [
  'lights', 'blinds', 'locks', 'fans', 'switches', 'climate-off', 'security', 'everything-off',
];

/**
 * Stable names, for anywhere the action is being talked *about* rather than
 * pressed. `HomeAction.label` names the direction the next press would go and
 * so flips with live device state — which is right on a card and wrong in a
 * settings list, where a row that renames itself when someone turns a lamp on
 * is just confusing.
 */
export const HOME_ACTION_NAMES: Record<HomeActionId, string> = {
  lights: 'Lights',
  blinds: 'Blinds & shades',
  locks: 'Lock up',
  fans: 'Fans',
  switches: 'Switches & outlets',
  'climate-off': 'Heating & cooling off',
  security: 'Security',
  'everything-off': 'Everything off',
};

/**
 * Cache values arrive JSON-stringified and devices disagree about the encoding,
 * so truthiness is checked by hand. Mirrors ServiceGroupWidget.getOnCount.
 */
export function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** The power characteristic an accessory actually reports, or null. */
function powerChar(accessory: HomeKitAccessory) {
  return getCharacteristic(accessory, 'on')
    ?? getCharacteristic(accessory, 'power_state')
    ?? getCharacteristic(accessory, 'active');
}

function isWritable(char: { isWritable?: boolean } | null): boolean {
  return !!char && char.isWritable !== false;
}

/** manufacturer/model live as characteristics on the accessory_information service. */
function positionLogicFor(accessory: HomeKitAccessory): boolean {
  let manufacturer = '';
  let model = '';
  for (const service of accessory.services || []) {
    for (const char of service.characteristics || []) {
      if (char.characteristicType === 'manufacturer') manufacturer = String(char.value ?? '');
      if (char.characteristicType === 'model') model = String(char.value ?? '');
    }
  }
  return usesStandardPositionLogic(manufacturer, model);
}

function countLabel(active: number, total: number, word: 'on' | 'open'): string {
  if (active === 0) return word === 'on' ? 'All off' : 'All closed';
  return `${active} of ${total} ${word}`;
}

/**
 * Power-bearing accessories of the given primary types, paired with their
 * current on/off reading. Used by lights, fans, switches and everything-off.
 */
function powerTargets(accessories: HomeKitAccessory[], types: string[]) {
  const out: Array<{ accessory: HomeKitAccessory; reported: string; value: unknown; on: boolean }> = [];
  for (const accessory of accessories) {
    const primary = getPrimaryServiceType(accessory);
    if (!primary || !types.includes(primary)) continue;
    const char = powerChar(accessory);
    if (!isWritable(char)) continue;
    out.push({ accessory, reported: char!.type, value: char!.value, on: isOn(char!.value) });
  }
  return out;
}

function powerWrites(
  targets: ReturnType<typeof powerTargets>,
  turnOn: boolean,
): HomeActionWrite[] {
  // Only touch what needs to change: keeps targetCount honest, and keeps the
  // fan-out (and the partial-failure toast) proportional to the real work.
  return targets
    .filter(t => t.on !== turnOn)
    .map(t => ({
      accessoryId: t.accessory.id,
      characteristicType: canonicalCharacteristic(t.reported),
      reportedCharacteristicType: t.reported,
      // Every widget that writes a power characteristic — including the
      // `active`-reporting ones (air purifier, camera, irrigation) — sends a
      // boolean, so the bridge coerces. Match that rather than inventing 1/0.
      value: turnOn,
      previousValue: t.value,
    }));
}

function oneStep(writes: HomeActionWrite[]): HomeActionStep[] {
  return [{ writes }];
}

function buildPowerAction(
  id: HomeActionId,
  accessories: HomeKitAccessory[],
  types: string[],
  opts: { icon: HomeActionIcon; serviceType: string; onLabel: string; offLabel: string },
): HomeAction | null {
  const targets = powerTargets(accessories, types);
  if (targets.length === 0) return null;

  const onCount = targets.filter(t => t.on).length;
  const turningOn = onCount === 0;
  const writes = powerWrites(targets, turningOn);

  return {
    id,
    label: turningOn ? opts.onLabel : opts.offLabel,
    subtitle: countLabel(onCount, targets.length, 'on'),
    icon: opts.icon,
    serviceType: opts.serviceType,
    targetCount: writes.length,
    turningOn,
    disabled: writes.length === 0,
    steps: oneStep(writes),
  };
}

function buildBlindsAction(accessories: HomeKitAccessory[]): HomeAction | null {
  const targets: Array<{ accessory: HomeKitAccessory; openness: number; raw: unknown; standard: boolean }> = [];
  for (const accessory of accessories) {
    if (getPrimaryServiceType(accessory) !== 'window_covering') continue;
    const target = getCharacteristic(accessory, 'target_position');
    if (!isWritable(target)) continue;
    const current = getCharacteristic(accessory, 'current_position');
    const standard = positionLogicFor(accessory);
    const raw = Number(current?.value ?? target!.value ?? 0);
    targets.push({ accessory, openness: toOpenness(raw, standard), raw: current?.value ?? target!.value, standard });
  }
  if (targets.length === 0) return null;

  // Anything off the stop counts as open — a blind at 3% is not "closed".
  const openCount = targets.filter(t => t.openness > 1).length;
  const turningOn = openCount === 0;
  const wantedOpenness = turningOn ? 100 : 0;

  const writes: HomeActionWrite[] = targets
    .filter(t => t.openness !== wantedOpenness)
    .map(t => ({
      accessoryId: t.accessory.id,
      characteristicType: 'target_position',
      reportedCharacteristicType: 'target_position',
      // Per accessory, never once for the set: most hardware counts 0 as open,
      // so a mixed-vendor home driven off a single shared value goes half
      // backwards. ServiceGroupWidget guards the same thing.
      value: fromOpenness(wantedOpenness, t.standard),
      previousValue: t.raw,
    }));

  return {
    id: 'blinds',
    label: turningOn ? 'Open all blinds' : 'Close all blinds',
    subtitle: countLabel(openCount, targets.length, 'open'),
    icon: 'blinds',
    serviceType: 'window_covering',
    targetCount: writes.length,
    turningOn,
    disabled: writes.length === 0,
    steps: oneStep(writes),
  };
}

function buildLocksAction(accessories: HomeKitAccessory[]): HomeAction | null {
  const targets: Array<{ accessory: HomeKitAccessory; locked: boolean; raw: unknown }> = [];
  for (const accessory of accessories) {
    if (getPrimaryServiceType(accessory) !== 'lock') continue;
    const target = getCharacteristic(accessory, 'lock_target_state');
    if (!isWritable(target)) continue;
    const current = getCharacteristic(accessory, 'lock_current_state');
    // HomeKit lock_current_state: 0 unsecured, 1 secured, 2 jammed, 3 unknown.
    const locked = Number(current?.value) === 1;
    targets.push({ accessory, locked, raw: target!.value });
  }
  if (targets.length === 0) return null;

  const unlocked = targets.filter(t => !t.locked);
  const writes: HomeActionWrite[] = unlocked.map(t => ({
    accessoryId: t.accessory.id,
    characteristicType: 'lock_target_state',
    reportedCharacteristicType: 'lock_target_state',
    value: true,
    previousValue: t.raw,
  }));

  return {
    id: 'locks',
    // Deliberately one-way. A home-screen chip that unlocks every door on a
    // mis-tap is not something a confirmation dialog makes acceptable; the
    // per-accessory LockWidget already covers unlocking.
    label: 'Lock up',
    subtitle: unlocked.length === 0 ? 'All locked' : `${unlocked.length} of ${targets.length} unlocked`,
    icon: 'lock',
    serviceType: 'lock',
    targetCount: writes.length,
    turningOn: false,
    disabled: writes.length === 0,
    steps: oneStep(writes),
  };
}

function buildClimateOffAction(accessories: HomeKitAccessory[]): HomeAction | null {
  const targets: Array<{ accessory: HomeKitAccessory; write: HomeActionWrite | null; active: boolean }> = [];
  for (const accessory of accessories) {
    const primary = getPrimaryServiceType(accessory);
    if (primary !== 'thermostat' && primary !== 'heater_cooler') continue;

    // The two service kinds turn off through different characteristics —
    // ThermostatWidget branches the same way.
    if (hasServiceType(accessory, 'heater_cooler')) {
      const active = getCharacteristic(accessory, 'active');
      if (!isWritable(active)) continue;
      const on = isOn(active!.value);
      targets.push({
        accessory,
        active: on,
        write: on ? {
          accessoryId: accessory.id,
          characteristicType: 'active',
          reportedCharacteristicType: 'active',
          value: false,
          previousValue: active!.value,
        } : null,
      });
    } else {
      const mode = getCharacteristic(accessory, 'heating_cooling_target');
      if (!isWritable(mode)) continue;
      const on = Number(mode!.value) !== 0; // 0 = Off
      targets.push({
        accessory,
        active: on,
        write: on ? {
          accessoryId: accessory.id,
          characteristicType: 'heating_cooling_target',
          reportedCharacteristicType: 'heating_cooling_target',
          value: 0,
          previousValue: mode!.value,
        } : null,
      });
    }
  }
  if (targets.length === 0) return null;

  const writes = targets.map(t => t.write).filter((w): w is HomeActionWrite => w !== null);
  const activeCount = targets.filter(t => t.active).length;

  return {
    id: 'climate-off',
    label: 'Turn off heating & cooling',
    subtitle: countLabel(activeCount, targets.length, 'on'),
    icon: 'thermostat',
    serviceType: 'thermostat',
    targetCount: writes.length,
    turningOn: false,
    disabled: writes.length === 0,
    steps: oneStep(writes),
  };
}

function buildSecurityAction(accessories: HomeKitAccessory[]): HomeAction | null {
  const targets: Array<{ accessory: HomeKitAccessory; state: number; raw: unknown }> = [];
  for (const accessory of accessories) {
    if (getPrimaryServiceType(accessory) !== 'security_system') continue;
    const target = getCharacteristic(accessory, 'security_system_target_state');
    if (!isWritable(target)) continue;
    const current = getCharacteristic(accessory, 'security_system_current_state');
    targets.push({
      accessory,
      state: normalizeSecurityState(current?.value ?? target!.value),
      raw: target!.value,
    });
  }
  if (targets.length === 0) return null;

  const armed = targets.filter(t => isSecurityArmed(t.state));
  const turningOn = armed.length === 0;
  const wanted = turningOn ? SECURITY_STATE.AWAY_ARM : SECURITY_STATE.DISARMED;

  const writes: HomeActionWrite[] = targets
    .filter(t => normalizeSecurityState(t.raw) !== wanted)
    .map(t => ({
      accessoryId: t.accessory.id,
      characteristicType: 'security_system_target_state',
      reportedCharacteristicType: 'security_system_target_state',
      value: wanted,
      previousValue: t.raw,
    }));

  const triggered = targets.some(t => t.state === SECURITY_STATE.TRIGGERED);
  const subtitle = triggered
    ? 'Triggered'
    : armed.length === 0
      ? 'Disarmed'
      : armed.length === targets.length
        ? 'Armed'
        : `${armed.length} of ${targets.length} armed`;

  return {
    id: 'security',
    label: turningOn ? 'Arm security' : 'Disarm security',
    subtitle,
    icon: 'shield',
    serviceType: 'security_system',
    targetCount: writes.length,
    turningOn,
    disabled: writes.length === 0,
    // The only action that asks. Disarming is the security-sensitive
    // direction; arming is confirmed too because setting Away while someone is
    // home is disruptive enough to be worth a beat.
    confirm: turningOn
      ? 'This sets every security system in the home to Away.'
      : 'This disarms every security system in the home.',
    steps: oneStep(writes),
  };
}

const EVERYTHING_TYPES = ['lightbulb', 'fan', 'switch', 'outlet'];

function buildEverythingOffAction(accessories: HomeKitAccessory[]): HomeAction | null {
  const targets = powerTargets(accessories, EVERYTHING_TYPES);
  if (targets.length === 0) return null;

  const onCount = targets.filter(t => t.on).length;
  const writes = powerWrites(targets, false);

  return {
    id: 'everything-off',
    // Blinds, locks and security are deliberately out of scope: "off" means
    // nothing for a blind, and folding the locks or the alarm into the
    // biggest, easiest-to-hit button would make its label a lie.
    label: 'Turn everything off',
    subtitle: onCount === 0 ? 'All off' : `${onCount} of ${targets.length} on`,
    icon: 'power',
    serviceType: 'switch',
    targetCount: writes.length,
    turningOn: false,
    disabled: writes.length === 0,
    steps: oneStep(writes),
  };
}

/**
 * Derive every action this home qualifies for, in display order.
 *
 * Callers pass the home's WHOLE accessory list, not the filtered view — "all
 * lights off" means every light, including ones sitting in a hidden room or
 * hidden from the dashboard for tidiness. The counts in each subtitle are
 * therefore home-wide too, and may exceed what is on screen.
 *
 * An action is omitted when the home has no accessories of its kind at all,
 * and returned `disabled` when it has them but there is nothing left to do —
 * so pressing "Turn everything off" dims the card rather than making it vanish
 * under the cursor.
 *
 * Bucketing is by `getPrimaryServiceType`, never by raw services: that
 * priority table is what stops a light which also exposes a `switch` service
 * from landing in both Lights and Switches and being written to twice.
 */
export function deriveHomeActions(accessories: HomeKitAccessory[]): HomeAction[] {
  const list = accessories ?? [];
  const built: Array<HomeAction | null> = [
    buildPowerAction('lights', list, ['lightbulb'], {
      icon: 'lightbulb', serviceType: 'lightbulb',
      onLabel: 'Turn all lights on', offLabel: 'Turn all lights off',
    }),
    buildBlindsAction(list),
    buildLocksAction(list),
    buildPowerAction('fans', list, ['fan'], {
      icon: 'fan', serviceType: 'fan',
      onLabel: 'Turn all fans on', offLabel: 'Turn all fans off',
    }),
    buildPowerAction('switches', list, ['switch', 'outlet'], {
      icon: 'outlet', serviceType: 'outlet',
      onLabel: 'Turn switches on', offLabel: 'Turn switches off',
    }),
    buildClimateOffAction(list),
    buildSecurityAction(list),
    buildEverythingOffAction(list),
  ];

  const byId = new Map(built.filter((a): a is HomeAction => a !== null).map(a => [a.id, a]));
  return HOME_ACTION_ORDER.map(id => byId.get(id)).filter((a): a is HomeAction => a !== undefined);
}
