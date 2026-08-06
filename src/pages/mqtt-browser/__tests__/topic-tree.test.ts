import { describe, it, expect } from 'vitest';
import {
  buildSlugToTopicMap,
  buildMemberTopicSet,
  buildTopicTree,
  findGroupForTopic,
  getEffectivePayload,
  rowTypeForTopic,
  type TopicMessage,
} from '../topic-tree';

const msg = (payload: object | string, updates = 1): TopicMessage => ({
  payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  timestamp: 1_700_000_000_000,
  updates,
});

// Mirrors the ?mock=1 seed: the group lives in the kitchen but one of its
// members is in the bedroom — members must render under the group anyway.
const GROUP = 'homecast/beach-house-1111/kitchen-aaaa/lights-group';
const KITCHEN_LAMP = 'homecast/beach-house-1111/kitchen-aaaa/lamp-a1b2';
const BEDROOM_LAMP = 'homecast/beach-house-1111/bedroom-bbbb/lamp-77a2';

// A helper accessory belongs to the home, not to a room, so it publishes one
// level up — the same shape as a roomless service group.
const HOME_LEVEL_HELPER = 'homecast/beach-house-1111/holiday-mode-8be1';

const messages: Record<string, TopicMessage> = {
  [KITCHEN_LAMP]: msg({ on: true, brightness: 72 }),
  [HOME_LEVEL_HELPER]: msg({ on: true }),
  'homecast/beach-house-1111/kitchen-aaaa/fan-9c8d': msg({ active: 1, speed: 30 }),
  [GROUP]: msg({ on: true, brightness: 40 }),
  [BEDROOM_LAMP]: msg({ on: false, brightness: 0 }),
  'homecast/beach-house-1111/bedroom-bbbb/lock-9911': msg({ locked: 1 }),
  'homecast/beach-house-1111/status': msg('online'),
  'homecast/county-hall-2222/lounge-cccc/lamp-ff00': msg({ on: true }),
};

const groupMembers: Record<string, string[]> = {
  // Members arrive as short-or-full slugs from the /members topic
  [GROUP]: [KITCHEN_LAMP, BEDROOM_LAMP],
};

const slugToTopic = buildSlugToTopicMap(messages);
const memberSet = buildMemberTopicSet(groupMembers, slugToTopic);
const filtered = Object.entries(messages).filter(([t]) => !memberSet.has(t)).sort(([a], [b]) => a.localeCompare(b));

const allPlainTopics = (tree: ReturnType<typeof buildTopicTree>) =>
  tree.flatMap(h => [...h.plain.map(([t]) => t), ...h.rooms.flatMap(r => r.plain.map(([t]) => t))]);

describe('buildSlugToTopicMap', () => {
  it('resolves member slugs by last path segment', () => {
    expect(slugToTopic.get('lamp-77a2')).toBe(BEDROOM_LAMP);
    expect(slugToTopic.get('lights-group')).toBe(GROUP);
  });
});

describe('buildTopicTree', () => {
  const tree = buildTopicTree(filtered, groupMembers, slugToTopic, messages, { groupByHome: true, groupByRoom: true });

  it('nests the group under its home and room with all members, including the cross-room one', () => {
    const beachHouse = tree.find(h => h.slug === 'beach-house-1111')!;
    expect(beachHouse).toBeDefined();
    const kitchen = beachHouse.rooms.find(r => r.slug === 'kitchen-aaaa')!;
    const group = kitchen.groups.find(g => g.topic === GROUP)!;
    expect(group).toBeDefined();
    const memberTopics = group.memberTopics.map(([t]) => t);
    expect(memberTopics).toContain(KITCHEN_LAMP);
    expect(memberTopics).toContain(BEDROOM_LAMP); // lives in bedroom-bbbb, still under the group
    expect(memberTopics).toHaveLength(2);
  });

  it('keeps member topics out of every plain list', () => {
    const plain = allPlainTopics(tree);
    expect(plain).not.toContain(KITCHEN_LAMP);
    expect(plain).not.toContain(BEDROOM_LAMP);
    expect(plain).toContain('homecast/beach-house-1111/kitchen-aaaa/fan-9c8d');
  });

  it('parks room-less topics (home status) at the home level', () => {
    const beachHouse = tree.find(h => h.slug === 'beach-house-1111')!;
    expect(beachHouse.plain.map(([t]) => t)).toContain('homecast/beach-house-1111/status');
  });

  it('parks a home-level accessory beside the home status, not in any room', () => {
    const beachHouse = tree.find(h => h.slug === 'beach-house-1111')!;
    expect(beachHouse.plain.map(([t]) => t)).toContain(HOME_LEVEL_HELPER);
    // It must not be mistaken for a room of its own, which is what an
    // `unknown-xxxx` room segment used to produce.
    expect(beachHouse.rooms.map(r => r.slug)).toEqual(['bedroom-bbbb', 'kitchen-aaaa']);
  });

  it('collapses to a single unlabeled bucket when home grouping is off', () => {
    const flat = buildTopicTree(filtered, groupMembers, slugToTopic, messages, { groupByHome: false, groupByRoom: false });
    expect(flat).toHaveLength(1);
    expect(flat[0].slug).toBe('');
    // Groups are still hoisted as nodes in the flat view
    expect(flat[0].groups.map(g => g.topic)).toContain(GROUP);
  });
});

describe('findGroupForTopic', () => {
  it('finds the containing group for a member topic', () => {
    expect(findGroupForTopic(BEDROOM_LAMP, groupMembers, slugToTopic)).toBe(GROUP);
    expect(findGroupForTopic('homecast/county-hall-2222/lounge-cccc/lamp-ff00', groupMembers, slugToTopic)).toBeUndefined();
  });
});

describe('getEffectivePayload', () => {
  it('prefers the group\'s own aggregated payload', () => {
    expect(getEffectivePayload(GROUP, messages[GROUP].payload, groupMembers, slugToTopic, messages))
      .toBe(messages[GROUP].payload);
  });

  it('falls back to the first member with content for a placeholder group payload', () => {
    expect(getEffectivePayload(GROUP, '{}', groupMembers, slugToTopic, messages))
      .toBe(messages[KITCHEN_LAMP].payload);
  });

  it('passes non-group payloads through untouched', () => {
    expect(getEffectivePayload(KITCHEN_LAMP, messages[KITCHEN_LAMP].payload, groupMembers, slugToTopic, messages))
      .toBe(messages[KITCHEN_LAMP].payload);
  });
});

describe('rowTypeForTopic', () => {
  it('classifies groups, home status rows and accessories', () => {
    expect(rowTypeForTopic(GROUP, groupMembers)).toBe('group');
    expect(rowTypeForTopic('homecast/beach-house-1111/status', groupMembers)).toBe('home');
    expect(rowTypeForTopic(KITCHEN_LAMP, groupMembers)).toBe('accessory');
    // Same depth as the home status row, but it is an accessory
    expect(rowTypeForTopic(HOME_LEVEL_HELPER, groupMembers)).toBe('accessory');
  });
});
