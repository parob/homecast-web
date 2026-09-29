import { describe, it, expect } from 'vitest';
import {
  allFull,
  availabilityLabel,
  canAddCloudHome,
  initialRelay,
  isRelayTakenError,
  recommendationReason,
  relayRegionCode,
} from '@/lib/relay-picker';
import type { CloudRelayOption } from '@/lib/graphql/types';

const relay = (id: string, over: Partial<CloudRelayOption> = {}): CloudRelayOption => ({
  id,
  label: id,
  region: 'gb',
  availability: 'plenty',
  online: true,
  recommended: false,
  ...over,
});

describe('initialRelay', () => {
  it('starts on the server recommendation', () => {
    expect(initialRelay([relay('a'), relay('b', { recommended: true })])?.id).toBe('b');
  });

  it('falls back to the first relay with space when none is recommended', () => {
    const relays = [relay('full', { availability: 'full' }), relay('down', { online: false })];
    expect(initialRelay(relays)?.id).toBe('down');
  });

  it('is empty when every relay is full, so the customer queues', () => {
    const relays = [relay('a', { availability: 'full' })];
    expect(initialRelay(relays)).toBeNull();
    expect(allFull(relays)).toBe(true);
  });
});

describe('wording', () => {
  it('labels availability softly', () => {
    expect(availabilityLabel('plenty')).toBe('Plenty of space');
    expect(availabilityLabel('limited')).toBe('Almost full');
    expect(availabilityLabel('full')).toBe('Full');
  });

  it('explains the recommendation', () => {
    expect(recommendationReason(relay('a'), 'gb')).toBe('Closest to you, with plenty of space');
    expect(recommendationReason(relay('a', { availability: 'limited' }), 'gb')).toBe('Closest to you');
    expect(recommendationReason(relay('a', { region: 'us' }), 'gb')).toBe('Most space available right now');
  });
});

describe('relayRegionCode', () => {
  it('gives the region as a plain code, and nothing when the server has none', () => {
    expect(relayRegionCode(relay('a'))).toBe('GB');
    expect(relayRegionCode(relay('a', { region: 'us' }))).toBe('US');
    expect(relayRegionCode(relay('a', { region: null }))).toBeNull();
  });
});

describe('canAddCloudHome', () => {
  it('follows the allowance, and defers to the server when it is unknown', () => {
    expect(canAddCloudHome({ cloudHomeLimit: 1, cloudHomesUsed: 0 })).toBe(true);
    expect(canAddCloudHome({ cloudHomeLimit: 1, cloudHomesUsed: 1 })).toBe(false);
    expect(canAddCloudHome({ cloudHomeLimit: 2, cloudHomesUsed: 3 })).toBe(false);
    expect(canAddCloudHome(undefined)).toBe(true);
  });
});

describe('isRelayTakenError', () => {
  it('recognises the race refusal', () => {
    expect(isRelayTakenError('That relay just filled up. Choose another.')).toBe(true);
    expect(isRelayTakenError("That relay isn't available. Choose another.")).toBe(true);
    expect(isRelayTakenError('Your plan includes one home')).toBe(false);
    expect(isRelayTakenError(null)).toBe(false);
  });
});
