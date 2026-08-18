import { describe, it, expect } from 'vitest';
import { homeCardKey, applyHomeCardOrder } from '../home-cards';

const key = (c: { kind: 'action' | 'scene'; id: string }) => homeCardKey(c.kind, c.id);
const action = (id: string) => ({ kind: 'action' as const, id });
const scene = (id: string) => ({ kind: 'scene' as const, id });

describe('homeCardKey', () => {
  it('keeps the two id spaces apart', () => {
    expect(homeCardKey('action', 'lights')).not.toBe(homeCardKey('scene', 'lights'));
  });

  it('survives a HomeKit UUID, which contains the character a hyphen key would split on', () => {
    const uuid = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';
    expect(homeCardKey('scene', uuid)).toBe(`scene:${uuid}`);
  });
});

describe('applyHomeCardOrder', () => {
  it('returns the items untouched when nothing is saved', () => {
    const items = [action('lights'), scene('s1')];
    expect(applyHomeCardOrder(items, undefined, key)).toEqual(items);
    expect(applyHomeCardOrder(items, [], key)).toEqual(items);
  });

  it('puts the items into the saved order, intermixing the two kinds', () => {
    const items = [action('lights'), action('locks'), scene('s1'), scene('s2')];
    const order = ['scene:s2', 'action:locks', 'scene:s1', 'action:lights'];

    expect(applyHomeCardOrder(items, order, key).map(key)).toEqual(order);
  });

  it('skips a key nothing answers to any more', () => {
    // The home lost its last fan, and a scene was deleted in Apple Home.
    const items = [action('lights'), scene('s1')];
    const order = ['action:fans', 'scene:deleted', 'scene:s1', 'action:lights'];

    expect(applyHomeCardOrder(items, order, key).map(key)).toEqual(['scene:s1', 'action:lights']);
  });

  it('keeps an order entry working when its card comes back', () => {
    const order = ['action:fans', 'action:lights'];
    const withoutFan = applyHomeCardOrder([action('lights')], order, key);
    expect(withoutFan.map(key)).toEqual(['action:lights']);

    const withFan = applyHomeCardOrder([action('lights'), action('fans')], order, key);
    expect(withFan.map(key)).toEqual(['action:fans', 'action:lights']);
  });

  it('appends anything the order has never heard of, in its own natural order', () => {
    const items = [action('lights'), scene('new-a'), scene('new-b')];
    const order = ['action:lights'];

    expect(applyHomeCardOrder(items, order, key).map(key))
      .toEqual(['action:lights', 'scene:new-a', 'scene:new-b']);
  });

  it('does not duplicate a card named twice in the order', () => {
    const items = [action('lights'), scene('s1')];
    const order = ['action:lights', 'action:lights', 'scene:s1'];

    expect(applyHomeCardOrder(items, order, key).map(key)).toEqual(['action:lights', 'scene:s1']);
  });

  it('never drops or invents a card', () => {
    const items = [action('lights'), action('locks'), scene('s1')];
    const out = applyHomeCardOrder(items, ['scene:s1', 'action:gone'], key);

    expect(out).toHaveLength(items.length);
    expect(new Set(out)).toEqual(new Set(items));
  });
});
