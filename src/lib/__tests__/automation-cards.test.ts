import { describe, it, expect } from 'vitest';
import {
  applyAutomationCardOrder,
  automationCardKey,
  isAutomationVisible,
  withAutomationVisibility,
} from '../automation-cards';

type Card = { kind: 'hk' | 'hc'; id: string };
const key = (c: Card) => automationCardKey(c.kind, c.id);
const hk = (id: string): Card => ({ kind: 'hk', id });
const hc = (id: string): Card => ({ kind: 'hc', id });

describe('keys', () => {
  it('keeps the two engines apart, which share no id space', () => {
    expect(automationCardKey('hk', '1')).not.toBe(automationCardKey('hc', '1'));
  });

  it('splits on a separator a HomeKit UUID cannot contain', () => {
    const uuid = 'B7A3F1C2-4D5E-6789-ABCD-0123456789EF';
    expect(automationCardKey('hk', uuid).split(':')).toEqual(['hk', uuid]);
  });
});

describe('applying a saved order', () => {
  it('leaves the list alone when nothing has been arranged', () => {
    const cards = [hk('a'), hc('b')];
    expect(applyAutomationCardOrder(cards, undefined, key)).toBe(cards);
    expect(applyAutomationCardOrder(cards, [], key)).toBe(cards);
  });

  it('interleaves the two engines however they were dragged', () => {
    const cards = [hk('a'), hk('b'), hc('x')];
    const out = applyAutomationCardOrder(cards, ['hc:x', 'hk:b', 'hk:a'], key);
    expect(out.map(key)).toEqual(['hc:x', 'hk:b', 'hk:a']);
  });

  it('skips a key that no longer resolves rather than failing', () => {
    // The normal state of a collapsed section: the Homecast half has not loaded.
    const out = applyAutomationCardOrder([hk('a')], ['hc:gone', 'hk:a'], key);
    expect(out.map(key)).toEqual(['hk:a']);
  });

  it('puts a newly created automation last, not first', () => {
    const out = applyAutomationCardOrder([hk('a'), hk('new')], ['hk:a'], key);
    expect(out.map(key)).toEqual(['hk:a', 'hk:new']);
  });

  it('keeps newcomers in the order their own engine gave them', () => {
    const out = applyAutomationCardOrder([hk('a'), hk('b'), hc('c')], ['hc:c'], key);
    expect(out.map(key)).toEqual(['hc:c', 'hk:a', 'hk:b']);
  });

  it('renders a repeated key once', () => {
    const out = applyAutomationCardOrder([hk('a'), hk('b')], ['hk:a', 'hk:a', 'hk:b'], key);
    expect(out.map(key)).toEqual(['hk:a', 'hk:b']);
  });

  it('loses nothing: every card comes out exactly once', () => {
    const cards = [hk('a'), hk('b'), hc('c'), hc('d')];
    const out = applyAutomationCardOrder(cards, ['hc:d', 'hk:b'], key);
    expect(out).toHaveLength(cards.length);
    expect(new Set(out.map(key)).size).toBe(cards.length);
  });
});

describe('visibility', () => {
  it('shows anything the list does not name, so no migration was needed', () => {
    expect(isAutomationVisible(undefined, 'hk:a')).toBe(true);
    expect(isAutomationVisible([], 'hk:a')).toBe(true);
  });

  it('hides what it does name', () => {
    expect(isAutomationVisible(['hk:a'], 'hk:a')).toBe(false);
    expect(isAutomationVisible(['hk:a'], 'hc:a')).toBe(true);
  });

  it('adds and removes', () => {
    expect(withAutomationVisibility(undefined, 'hk:a', false)).toEqual(['hk:a']);
    expect(withAutomationVisibility(['hk:a'], 'hk:a', true)).toEqual([]);
  });

  it('sorts on write, so two writes of one set produce identical JSON', () => {
    expect(withAutomationVisibility(['hk:b'], 'hc:a', false)).toEqual(['hc:a', 'hk:b']);
  });

  it('never duplicates a key already hidden', () => {
    expect(withAutomationVisibility(['hk:a'], 'hk:a', false)).toEqual(['hk:a']);
  });

  it('keeps hidden keys for automations that have not loaded yet', () => {
    // The whole reason this is a Set-and-sort rather than a filter through a
    // catalog: hiding one automation must not forget the others while the
    // relay is still answering.
    expect(withAutomationVisibility(['hk:offline'], 'hc:here', false))
      .toEqual(['hc:here', 'hk:offline']);
  });
});
