import { describe, it, expect } from 'vitest';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { deriveHomeActions, isOn, HOME_ACTION_ORDER } from '../catalog';

type Char = { characteristicType: string; value: unknown; isWritable?: boolean };

function acc(id: string, services: Array<{ serviceType: string; characteristics: Char[] }>): HomeKitAccessory {
  return {
    id,
    name: id,
    roomName: 'Room',
    category: 'other',
    isReachable: true,
    services: services.map((s, i) => ({
      id: `${id}-svc-${i}`,
      name: s.serviceType,
      serviceType: s.serviceType,
      characteristics: s.characteristics.map((c, j) => ({
        id: `${id}-char-${i}-${j}`,
        characteristicType: c.characteristicType,
        value: c.value,
        isReadable: true,
        isWritable: c.isWritable ?? true,
      })),
    })),
  } as HomeKitAccessory;
}

const light = (id: string, on: unknown, charName = 'power_state') =>
  acc(id, [{ serviceType: 'lightbulb', characteristics: [{ characteristicType: charName, value: on }] }]);

/** manufacturer/model live on accessory_information and decide position semantics. */
function blind(id: string, currentPosition: number, manufacturer: string): HomeKitAccessory {
  return acc(id, [
    { serviceType: 'accessory_information', characteristics: [
      { characteristicType: 'manufacturer', value: manufacturer },
      { characteristicType: 'model', value: 'Shade' },
    ] },
    { serviceType: 'window_covering', characteristics: [
      { characteristicType: 'current_position', value: currentPosition },
      { characteristicType: 'target_position', value: currentPosition },
    ] },
  ]);
}

const lock = (id: string, currentState: number) =>
  acc(id, [{ serviceType: 'lock', characteristics: [
    { characteristicType: 'lock_current_state', value: currentState },
    { characteristicType: 'lock_target_state', value: currentState === 1 },
  ] }]);

const find = (list: ReturnType<typeof deriveHomeActions>, id: string) => list.find(a => a.id === id);
const writesOf = (list: ReturnType<typeof deriveHomeActions>, id: string) =>
  find(list, id)?.steps.flatMap(s => s.writes) ?? [];

describe('isOn', () => {
  it('accepts every encoding a device might report', () => {
    for (const v of [true, 1, '1', 'true']) expect(isOn(v)).toBe(true);
    for (const v of [false, 0, '0', 'false', null, undefined, '']) expect(isOn(v)).toBe(false);
  });
});

describe('deriveHomeActions — lights', () => {
  it('offers "off" while any light is on, and writes only the ones that are on', () => {
    const actions = deriveHomeActions([light('a', true), light('b', false), light('c', true)]);
    const lights = find(actions, 'lights')!;

    expect(lights.turningOn).toBe(false);
    // The label names the set now, not the press: the toggle owns the direction
    // and a title that flipped under it would describe the wrong half.
    expect(lights.label).toBe('All lights');
    expect(lights.subtitle).toBe('2 of 3 on');
    expect(lights.disabled).toBe(false);

    const writes = writesOf(actions, 'lights');
    expect(writes.map(w => w.accessoryId).sort()).toEqual(['a', 'c']);
    expect(writes.every(w => w.value === false)).toBe(true);
    expect(writes.every(w => w.characteristicType === 'power_state')).toBe(true);
  });

  it('flips to "on" only once every light is off', () => {
    const actions = deriveHomeActions([light('a', false), light('b', false)]);
    const lights = find(actions, 'lights')!;
    expect(lights.turningOn).toBe(true);
    expect(lights.label).toBe('All lights');
    expect(lights.subtitle).toBe('All off');
    expect(writesOf(actions, 'lights').every(w => w.value === true)).toBe(true);
  });

  it('gives a running label that follows the same direction as the label', () => {
    expect(find(deriveHomeActions([light('a', true)]), 'lights')!.runningLabel)
      .toBe('Turning off');
    expect(find(deriveHomeActions([light('a', false)]), 'lights')!.runningLabel)
      .toBe('Turning on');
  });

  it('canonicalises an `on`-reporting light but remembers the reported name', () => {
    const writes = writesOf(deriveHomeActions([light('a', true, 'on')]), 'lights');
    expect(writes[0].characteristicType).toBe('power_state');
    expect(writes[0].reportedCharacteristicType).toBe('on');
  });

  it('includes an unreachable light rather than quietly leaving it on', () => {
    // isReachable goes stale often, and "all lights off" that skips devices is
    // worse than one that tries and reports the failures.
    const offline = { ...light('a', true), isReachable: false };
    const writes = writesOf(deriveHomeActions([offline, light('b', true)]), 'lights');
    expect(writes.map(w => w.accessoryId).sort()).toEqual(['a', 'b']);
  });

  it('skips a light whose power characteristic is read-only', () => {
    const readOnly = acc('a', [{ serviceType: 'lightbulb', characteristics: [
      { characteristicType: 'power_state', value: true, isWritable: false },
    ] }]);
    expect(find(deriveHomeActions([readOnly]), 'lights')).toBeUndefined();
  });
});

describe('deriveHomeActions — service-type priority', () => {
  it('puts a light that also exposes a switch service in Lights only, written once', () => {
    const hybrid = acc('a', [
      { serviceType: 'switch', characteristics: [{ characteristicType: 'power_state', value: true }] },
      { serviceType: 'lightbulb', characteristics: [{ characteristicType: 'power_state', value: true }] },
    ]);
    const actions = deriveHomeActions([hybrid]);

    expect(writesOf(actions, 'lights').map(w => w.accessoryId)).toEqual(['a']);
    expect(find(actions, 'switches')).toBeUndefined();
    // and exactly one write reaches it overall, ignoring the everything-off duplicate bucket
    expect(writesOf(actions, 'lights')).toHaveLength(1);
  });
});

describe('deriveHomeActions — blinds', () => {
  it('closes a mixed-vendor pair in opposite raw directions', () => {
    // Lutron counts 0 = closed; most other hardware counts 0 = open.
    const actions = deriveHomeActions([blind('lutron', 80, 'Lutron'), blind('aqara', 20, 'Aqara')]);
    const blinds = find(actions, 'blinds')!;

    expect(blinds.turningOn).toBe(false);
    expect(blinds.label).toBe('Close all blinds');

    const writes = writesOf(actions, 'blinds');
    expect(writes.find(w => w.accessoryId === 'lutron')!.value).toBe(0);
    expect(writes.find(w => w.accessoryId === 'aqara')!.value).toBe(100);
  });

  it('opens both in opposite raw directions when everything is shut', () => {
    const actions = deriveHomeActions([blind('lutron', 0, 'Lutron'), blind('aqara', 100, 'Aqara')]);
    const blinds = find(actions, 'blinds')!;

    expect(blinds.turningOn).toBe(true);
    expect(blinds.label).toBe('Open all blinds');
    expect(blinds.subtitle).toBe('All closed');

    const writes = writesOf(actions, 'blinds');
    expect(writes.find(w => w.accessoryId === 'lutron')!.value).toBe(100);
    expect(writes.find(w => w.accessoryId === 'aqara')!.value).toBe(0);
  });
});

describe('deriveHomeActions — locks', () => {
  it('is one-way: locks what is open and never emits an unlock', () => {
    const actions = deriveHomeActions([lock('a', 0), lock('b', 1)]);
    const locks = find(actions, 'locks')!;

    expect(locks.label).toBe('Lock up');
    expect(locks.subtitle).toBe('1 of 2 unlocked');
    const writes = writesOf(actions, 'locks');
    expect(writes.map(w => w.accessoryId)).toEqual(['a']);
    expect(writes.every(w => w.value === true)).toBe(true);
  });

  it('stays present but disabled once everything is locked', () => {
    const locks = find(deriveHomeActions([lock('a', 1), lock('b', 1)]), 'locks')!;
    expect(locks.disabled).toBe(true);
    expect(locks.subtitle).toBe('All locked');
    expect(locks.steps.flatMap(s => s.writes)).toHaveLength(0);
  });

  it('treats a jammed lock as not locked', () => {
    const locks = find(deriveHomeActions([lock('a', 2)]), 'locks')!;
    expect(locks.disabled).toBe(false);
    expect(locks.subtitle).toBe('1 of 1 unlocked');
  });
});

describe('deriveHomeActions — climate', () => {
  it('turns a thermostat off through heating_cooling_target', () => {
    const thermostat = acc('t', [{ serviceType: 'thermostat', characteristics: [
      { characteristicType: 'heating_cooling_target', value: 1 },
    ] }]);
    const writes = writesOf(deriveHomeActions([thermostat]), 'climate-off');
    expect(writes).toEqual([expect.objectContaining({
      accessoryId: 't', characteristicType: 'heating_cooling_target', value: 0, previousValue: 1,
    })]);
  });

  it('turns a heater/cooler off through active', () => {
    const hc = acc('h', [{ serviceType: 'heater_cooler', characteristics: [
      { characteristicType: 'active', value: true },
    ] }]);
    const writes = writesOf(deriveHomeActions([hc]), 'climate-off');
    expect(writes).toEqual([expect.objectContaining({
      accessoryId: 'h', characteristicType: 'active', value: false,
    })]);
  });

  it('is disabled when everything is already off', () => {
    const thermostat = acc('t', [{ serviceType: 'thermostat', characteristics: [
      { characteristicType: 'heating_cooling_target', value: 0 },
    ] }]);
    const climate = find(deriveHomeActions([thermostat]), 'climate-off')!;
    expect(climate.disabled).toBe(true);
    expect(climate.subtitle).toBe('All off');
  });
});

describe('deriveHomeActions — security', () => {
  const system = (id: string, current: number) =>
    acc(id, [{ serviceType: 'security_system', characteristics: [
      { characteristicType: 'security_system_current_state', value: current },
      { characteristicType: 'security_system_target_state', value: current },
    ] }]);

  it('arms to Away when everything is disarmed, and confirms', () => {
    const actions = deriveHomeActions([system('a', 3)]);
    const security = find(actions, 'security')!;
    expect(security.turningOn).toBe(true);
    expect(security.label).toBe('Arm security');
    expect(security.subtitle).toBe('Disarmed');
    expect(security.confirm).toBeTruthy();
    expect(writesOf(actions, 'security')[0].value).toBe(1);
  });

  it('disarms when any system is armed, and confirms', () => {
    const actions = deriveHomeActions([system('a', 1), system('b', 3)]);
    const security = find(actions, 'security')!;
    expect(security.turningOn).toBe(false);
    expect(security.label).toBe('Disarm security');
    expect(security.subtitle).toBe('1 of 2 armed');
    expect(security.confirm).toBeTruthy();
    expect(writesOf(actions, 'security').map(w => w.accessoryId)).toEqual(['a']);
    expect(writesOf(actions, 'security')[0].value).toBe(3);
  });

  it('offers Disarm for a triggered system, not Arm', () => {
    const actions = deriveHomeActions([system('a', 4)]);
    const security = find(actions, 'security')!;
    expect(security.label).toBe('Disarm security');
    expect(security.subtitle).toBe('Triggered');
  });
});

describe('deriveHomeActions — everything off', () => {
  const fan = (id: string, on: boolean) =>
    acc(id, [{ serviceType: 'fan', characteristics: [{ characteristicType: 'active', value: on }] }]);
  const outlet = (id: string, on: boolean) =>
    acc(id, [{ serviceType: 'outlet', characteristics: [{ characteristicType: 'power_state', value: on }] }]);

  it('covers lights, fans, switches and outlets but never locks, blinds or security', () => {
    const actions = deriveHomeActions([
      light('l', true), fan('f', true), outlet('o', true),
      lock('k', 0), blind('b', 80, 'Lutron'),
    ]);
    const ids = writesOf(actions, 'everything-off').map(w => w.accessoryId).sort();
    expect(ids).toEqual(['f', 'l', 'o']);
  });

  it('stays present but disabled when nothing is on, rather than vanishing mid-press', () => {
    const everything = find(deriveHomeActions([light('l', false), fan('f', false)]), 'everything-off')!;
    expect(everything.disabled).toBe(true);
    expect(everything.subtitle).toBe('All off');
  });
});

describe('deriveHomeActions — shape', () => {
  it('returns nothing for a home of sensors only', () => {
    const sensor = acc('s', [{ serviceType: 'motion_sensor', characteristics: [
      { characteristicType: 'motion_detected', value: true, isWritable: false },
    ] }]);
    expect(deriveHomeActions([sensor])).toEqual([]);
  });

  it('returns nothing for an empty home', () => {
    expect(deriveHomeActions([])).toEqual([]);
  });

  it('emits actions in catalog order', () => {
    const actions = deriveHomeActions([light('l', true), lock('k', 0), blind('b', 80, 'Lutron')]);
    const order = actions.map(a => a.id);
    expect(order).toEqual([...HOME_ACTION_ORDER].filter(id => order.includes(id)));
  });
});

describe('two-way actions carry both directions', () => {
  const toggleOf = (list: ReturnType<typeof deriveHomeActions>, id: string) => find(list, id)!.toggle!;
  const idsOf = (steps: { writes: { accessoryId: string }[] }[]) =>
    steps.flatMap(s => s.writes).map(w => w.accessoryId).sort();

  it('reports mixed, and writes only what each direction would change', () => {
    // `steps` alone could never drive a switch: it holds one direction, the one
    // the catalog chose. A toggle hands that choice to the user, so both have
    // to exist before either is asked for.
    const actions = deriveHomeActions([light('a', true), light('b', false), light('c', true)]);
    const toggle = toggleOf(actions, 'lights');

    expect(toggle.state).toBe('mixed');
    expect(toggle.onCount).toBe(2);
    expect(toggle.total).toBe(3);

    // Only the one that is off needs turning on; only the two that are on need
    // turning off.
    expect(idsOf(toggle.onSteps)).toEqual(['b']);
    expect(idsOf(toggle.offSteps)).toEqual(['a', 'c']);
    expect(toggle.onSteps.flatMap(s => s.writes).every(w => w.value === true)).toBe(true);
    expect(toggle.offSteps.flatMap(s => s.writes).every(w => w.value === false)).toBe(true);
  });

  it('leaves the direction it is already at with nothing to write', () => {
    const allOn = toggleOf(deriveHomeActions([light('a', true), light('b', true)]), 'lights');
    expect(allOn.state).toBe('on');
    expect(allOn.onSteps.flatMap(s => s.writes)).toHaveLength(0);
    expect(idsOf(allOn.offSteps)).toEqual(['a', 'b']);

    const allOff = toggleOf(deriveHomeActions([light('a', false), light('b', false)]), 'lights');
    expect(allOff.state).toBe('off');
    expect(idsOf(allOff.onSteps)).toEqual(['a', 'b']);
    expect(allOff.offSteps.flatMap(s => s.writes)).toHaveLength(0);
  });

  it('is never disabled, because neither end is the end of the road', () => {
    // "All on" used to be nothing-to-do for the next press. A toggle can still
    // go the other way, and dimming would strand the user at that end.
    for (const lights of [[light('a', true)], [light('a', false)]]) {
      expect(find(deriveHomeActions(lights), 'lights')!.disabled).toBe(false);
    }
  });

  it('gives one to every pure power action, and to nothing else', () => {
    const actions = deriveHomeActions([
      light('a', true),
      acc('f', [{ serviceType: 'fan', characteristics: [{ characteristicType: 'power_state', value: false }] }]),
      acc('o', [{ serviceType: 'outlet', characteristics: [{ characteristicType: 'power_state', value: true }] }]),
      blind('b', 0, 'Eve'),
      lock('k', 0),
      acc('t', [{ serviceType: 'thermostat', characteristics: [{ characteristicType: 'heating_cooling_target', value: 1 }] }]),
      acc('s', [{ serviceType: 'security_system', characteristics: [
        { characteristicType: 'security_system_current_state', value: 3 },
        { characteristicType: 'security_system_target_state', value: 3 },
      ] }]),
    ]);

    expect(actions.filter(a => a.toggle).map(a => a.id).sort())
      .toEqual(['fans', 'lights', 'switches']);

    // The rest are one-way by decision, not by omission: "open" is not "on",
    // unlocking every door from a slider is not something we offer, there is no
    // "everything on", and security keeps its confirmation on a deliberate press.
    for (const id of ['blinds', 'locks', 'climate-off', 'security', 'everything-off']) {
      expect(find(actions, id)!.toggle).toBeUndefined();
    }
  });

  it('keeps `steps` as the single next-press direction the tab-bar pin runs', () => {
    // A pinned tab has no switch to read a direction from, so it still runs the
    // catalog's own choice — which must not have moved.
    const actions = deriveHomeActions([light('a', true), light('b', false)]);
    const lights = find(actions, 'lights')!;
    expect(lights.turningOn).toBe(false);
    expect(idsOf(lights.steps)).toEqual(['a']);
    expect(idsOf(lights.steps)).toEqual(idsOf(lights.toggle!.offSteps));
  });
});

describe('lights that cannot answer stop holding the toggle open', () => {
  // A Hue bulb switched off at the wall is unreachable, not disobedient. It can
  // never report on, so a strict count leaves "All lights" stuck at mixed — and
  // the next press writes only "what needs changing", which is exactly the
  // bulbs that cannot answer. The action then nags, fails, and nags again.
  const light = (id: string, on: boolean, reachable = true) => ({
    id, name: id, isReachable: reachable,
    services: [{
      serviceType: 'lightbulb', name: id,
      characteristics: [{ type: 'on', characteristicType: 'on', value: on, isWritable: true }],
    }],
  } as unknown as Parameters<typeof deriveHomeActions>[0][number]);

  const lights = (a: ReturnType<typeof deriveHomeActions>) => a.find(x => x.id === 'lights')!;

  it('reads as on when the rest are unreachable and enough are on', () => {
    // 8 on, 2 off but unreachable = 80%, over the floor.
    const on = Array.from({ length: 8 }, (_, i) => light(`on${i}`, true));
    const dead = [light('dead1', false, false), light('dead2', false, false)];
    const action = lights(deriveHomeActions([...on, ...dead]));

    expect(action.toggle!.state).toBe('on');
    expect(action.subtitle).toBe('All on · 2 not responding');
    // and the next press turns the house OFF rather than retrying the dead two
    expect(action.turningOn).toBe(false);
  });

  it('stays mixed when a reachable light is still off', () => {
    // The rule is about accessories that COULD not answer, never about ones
    // that simply have not been asked yet.
    const action = lights(deriveHomeActions([
      light('a', true), light('b', true), light('c', true), light('d', true),
      light('e', true), light('f', true), light('g', true), light('h', true),
      light('off', false),            // reachable and off
      light('dead', false, false),
    ]));

    expect(action.toggle!.state).toBe('mixed');
  });

  it('stays mixed when too few are on to mean it', () => {
    // Twenty on and two hundred unreachable must not read as "All on" — that
    // is a lie with a straight face, and the floor exists to stop it.
    const on = Array.from({ length: 2 }, (_, i) => light(`on${i}`, true));
    const dead = Array.from({ length: 8 }, (_, i) => light(`dead${i}`, false, false));
    const action = lights(deriveHomeActions([...on, ...dead]));

    expect(action.toggle!.state).toBe('mixed');
    expect(action.subtitle).toBe('2 of 10 on');
  });

  it('carries reachability onto the writes, so the executor can tell them apart', () => {
    const action = lights(deriveHomeActions([light('a', false), light('dead', false, false)]));
    const writes = action.steps.flatMap(s => s.writes);

    expect(writes.find(w => w.accessoryId === 'dead')?.reachable).toBe(false);
    expect(writes.find(w => w.accessoryId === 'a')?.reachable).toBe(true);
  });
});
