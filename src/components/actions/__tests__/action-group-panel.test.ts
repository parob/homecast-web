/**
 * The write side of a shortcut card's expanded panel.
 *
 * Everything the panel *shows* is `ServiceGroupWidget`'s decision and is tested
 * with that component. What is new here is the write set behind its sliders,
 * and it encodes three answers given when the panel was asked for: absolute
 * values, every member rather than only the lit ones, and silence — not a
 * failure — for a member that cannot take the characteristic at all.
 */
import { describe, it, expect } from 'vitest';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { deriveHomeActions, memberWrites, isExpandableAction } from '../catalog';

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

/** A dimmable bulb: power plus a brightness it can be set to. */
const dimmable = (id: string, on: boolean, brightness: number) =>
  acc(id, [{ serviceType: 'lightbulb', characteristics: [
    { characteristicType: 'power_state', value: on },
    { characteristicType: 'brightness', value: brightness },
  ] }]);

/** A bulb that only switches — the one every "some support it" rule is about. */
const plain = (id: string, on: boolean) =>
  acc(id, [{ serviceType: 'lightbulb', characteristics: [
    { characteristicType: 'power_state', value: on },
  ] }]);

/** Dimmable and colour-capable. */
const colour = (id: string, on: boolean) =>
  acc(id, [{ serviceType: 'lightbulb', characteristics: [
    { characteristicType: 'power_state', value: on },
    { characteristicType: 'brightness', value: 50 },
    { characteristicType: 'hue', value: 120 },
    { characteristicType: 'saturation', value: 40 },
  ] }]);

const lightsAction = (accessories: HomeKitAccessory[]) =>
  deriveHomeActions(accessories).find(a => a.id === 'lights')!;

describe('an action carries its whole membership', () => {
  it('lists every member, not just the ones the next press would write to', () => {
    const home = [dimmable('a', true, 80), plain('b', false)];
    const lights = lightsAction(home);

    // The press turns the house off, so it writes to one light.
    expect(lights.steps.flatMap(s => s.writes)).toHaveLength(1);
    // The panel is about the set, and the set is both.
    expect(lights.memberIds).toEqual(['a', 'b']);
  });

  it('marks the power shortcuts expandable and leaves the one-way ones alone', () => {
    const actions = deriveHomeActions([
      dimmable('a', true, 80),
      acc('lock-1', [{ serviceType: 'lock', characteristics: [
        { characteristicType: 'lock_current_state', value: 0 },
        { characteristicType: 'lock_target_state', value: false },
      ] }]),
    ]);

    expect(isExpandableAction(actions.find(a => a.id === 'lights')!)).toBe(true);
    // "Set the brightness of Lock up" is not a question.
    expect(isExpandableAction(actions.find(a => a.id === 'locks')!)).toBe(false);
    // Everything off spans four device kinds; its shared vocabulary is the
    // on/off it already has a control for.
    expect(isExpandableAction(actions.find(a => a.id === 'everything-off')!)).toBe(false);
  });
});

describe('memberWrites', () => {
  it('writes the same absolute value to every member', () => {
    const home = [dimmable('a', true, 10), dimmable('b', true, 90)];
    const writes = memberWrites(home, lightsAction(home).memberIds!, 'brightness', 40);

    // Absolute, not a shift: two lights 80 apart both land on 40. A relative
    // group slider drifts further apart on every drag and can never be brought
    // back into line.
    expect(writes.map(w => [w.accessoryId, w.value])).toEqual([['a', 40], ['b', 40]]);
  });

  it('writes to a light that is off, not only the lit ones', () => {
    const home = [dimmable('on', true, 10), dimmable('off', false, 10)];
    const writes = memberWrites(home, lightsAction(home).memberIds!, 'brightness', 65);

    expect(writes.map(w => w.accessoryId)).toEqual(['on', 'off']);
  });

  it('skips a member that cannot take the characteristic, rather than failing it', () => {
    const home = [dimmable('dim', true, 10), plain('plain', true)];
    const writes = memberWrites(home, lightsAction(home).memberIds!, 'brightness', 65);

    // The distinction that matters: no write at all. A write that went out and
    // failed would land in the run's failure toast, which is how a colour
    // change in a mostly-white home would have reported dozens of accessories
    // "not responding" for doing exactly what they should.
    expect(writes).toHaveLength(1);
    expect(writes[0].accessoryId).toBe('dim');
  });

  it('skips a member whose characteristic is read-only', () => {
    const readOnly = acc('ro', [{ serviceType: 'lightbulb', characteristics: [
      { characteristicType: 'power_state', value: true },
      { characteristicType: 'brightness', value: 30, isWritable: false },
    ] }]);
    const home = [dimmable('dim', true, 10), readOnly];

    const writes = memberWrites(home, lightsAction(home).memberIds!, 'brightness', 65);
    expect(writes.map(w => w.accessoryId)).toEqual(['dim']);
  });

  it('carries each light’s own previous value, so a failure reverts to it', () => {
    const home = [dimmable('a', true, 10), dimmable('b', true, 90)];
    const writes = memberWrites(home, lightsAction(home).memberIds!, 'brightness', 40);

    // Not the group average — that would silently level the house on any
    // partial failure.
    expect(writes.map(w => w.previousValue)).toEqual([10, 90]);
  });

  it('writes colour only to the members that have it', () => {
    const home = [colour('rgb', true), dimmable('white', true, 50), plain('bare', true)];
    const ids = lightsAction(home).memberIds!;

    expect(memberWrites(home, ids, 'hue', 200).map(w => w.accessoryId)).toEqual(['rgb']);
    expect(memberWrites(home, ids, 'saturation', 80).map(w => w.accessoryId)).toEqual(['rgb']);
    // …while brightness reaches both of the ones that dim.
    expect(memberWrites(home, ids, 'brightness', 20).map(w => w.accessoryId)).toEqual(['rgb', 'white']);
  });

  it('ignores accessories outside the action', () => {
    const fan = acc('fan-1', [{ serviceType: 'fan', characteristics: [
      { characteristicType: 'power_state', value: true },
      { characteristicType: 'brightness', value: 50 },
    ] }]);
    const home = [dimmable('lamp', true, 10), fan];

    // The fan is a member of All fans, never of All lights, even though it
    // happens to report a brightness.
    const writes = memberWrites(home, lightsAction(home).memberIds!, 'brightness', 40);
    expect(writes.map(w => w.accessoryId)).toEqual(['lamp']);
  });

  it('answers with nothing when no member supports it at all', () => {
    const home = [plain('a', true), plain('b', false)];
    expect(memberWrites(home, lightsAction(home).memberIds!, 'brightness', 40)).toEqual([]);
  });
});
