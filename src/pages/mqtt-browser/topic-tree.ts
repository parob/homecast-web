// Pure tree-building logic for the MQTT browser — no React, unit-testable.
//
// Topics follow homecast/{home}/{room}/{accessory}; service groups publish a
// retained {group}/members JSON array of member slugs. Members are resolved
// by their last path segment because older relays publish short slugs.

export interface TopicMessage { payload: string; timestamp: number; updates: number; }

export type MqttRowType = 'home' | 'room' | 'group' | 'accessory';

export interface GroupBucket {
  topic: string;
  payload: TopicMessage;
  memberTopics: Array<[string, TopicMessage]>;
}

export interface RoomBucket {
  slug: string;
  plain: Array<[string, TopicMessage]>;
  groups: GroupBucket[];
}

export interface HomeBucket {
  slug: string;
  rooms: RoomBucket[];
  // Topics with no room segment (homecast/<home>/...) — plain + group variants
  plain: Array<[string, TopicMessage]>;
  groups: GroupBucket[];
  allTopicCount: number;
}

/**
 * Map each topic's last path segment to its full topic. First match wins,
 * mirroring the previous `Object.keys(messages).find(t => t.endsWith(...))`
 * scans; collisions between duplicate accessory slugs resolve identically.
 */
export function buildSlugToTopicMap(messages: Record<string, TopicMessage>): Map<string, string> {
  const map = new Map<string, string>();
  for (const topic of Object.keys(messages)) {
    const idx = topic.lastIndexOf('/');
    if (idx < 0) continue;
    const short = topic.slice(idx + 1);
    if (!map.has(short)) map.set(short, topic);
  }
  return map;
}

/** Resolve a member slug (short or full) to the live topic it refers to. */
export function resolveMemberTopic(memberSlug: string, slugToTopic: Map<string, string>): string | undefined {
  const short = memberSlug.split('/').pop();
  if (!short) return undefined;
  return slugToTopic.get(short);
}

/** All topics that are members of some group — hidden from plain lists. */
export function buildMemberTopicSet(
  groupMembers: Record<string, string[]>,
  slugToTopic: Map<string, string>,
): Set<string> {
  const set = new Set<string>();
  for (const [groupTopic, members] of Object.entries(groupMembers)) {
    for (const memberSlug of members) {
      const full = resolveMemberTopic(memberSlug, slugToTopic);
      if (full && full !== groupTopic) set.add(full);
    }
  }
  return set;
}

/** Reverse lookup: the group a topic belongs to, if any. */
export function findGroupForTopic(
  topic: string,
  groupMembers: Record<string, string[]>,
  slugToTopic: Map<string, string>,
): string | undefined {
  for (const [groupTopic, members] of Object.entries(groupMembers)) {
    if (groupTopic === topic) continue;
    if (members.some(m => resolveMemberTopic(m, slugToTopic) === topic)) return groupTopic;
  }
  return undefined;
}

export function rowTypeForTopic(topic: string, groupMembers: Record<string, string[]>): MqttRowType {
  if (groupMembers[topic]) return 'group';
  const parts = topic.split('/');
  if (parts[0] === 'homecast' && parts.length === 3 && parts[2] === 'status') return 'home';
  return 'accessory';
}

/**
 * The payload to display/control for a topic. Groups prefer their own
 * aggregated retained payload (any-member-on semantics); the placeholder `{}`
 * published before an older relay sends real group state falls back to the
 * first member with content.
 */
export function getEffectivePayload(
  topic: string,
  payload: string,
  groupMembers: Record<string, string[]>,
  slugToTopic: Map<string, string>,
  messages: Record<string, TopicMessage>,
): string {
  if (!groupMembers[topic]) return payload;
  try {
    const p = JSON.parse(payload);
    if (p && Object.keys(p).length > 0 && !p.members) return payload;
  } catch { /* placeholder or unparsable — try members */ }
  for (const memberSlug of groupMembers[topic] || []) {
    const mt = resolveMemberTopic(memberSlug, slugToTopic);
    if (mt && messages[mt]?.payload) {
      try {
        const p = JSON.parse(messages[mt].payload);
        if (Object.keys(p).length > 0 && !p.members) return messages[mt].payload;
      } catch { /* skip */ }
    }
  }
  return payload;
}

/**
 * Build the home → room → group/accessory tree. `topics` must already be
 * search-filtered and member-free (see buildMemberTopicSet); group member
 * rows are pulled from the full messages map so they always render under
 * their group — including members that live in a different room.
 */
export function buildTopicTree(
  topics: Array<[string, TopicMessage]>,
  groupMembers: Record<string, string[]>,
  slugToTopic: Map<string, string>,
  messages: Record<string, TopicMessage>,
  opts: { groupByHome: boolean; groupByRoom: boolean },
): HomeBucket[] {
  const buildGroup = (topic: string, payload: TopicMessage): GroupBucket => {
    const memberTopics: Array<[string, TopicMessage]> = [];
    for (const memberSlug of groupMembers[topic] || []) {
      const full = resolveMemberTopic(memberSlug, slugToTopic);
      if (full && messages[full]) memberTopics.push([full, messages[full]]);
    }
    return { topic, payload, memberTopics };
  };

  const byHome = new Map<string, HomeBucket>();
  const ensureHome = (slug: string) => {
    if (!byHome.has(slug)) byHome.set(slug, { slug, rooms: [], plain: [], groups: [], allTopicCount: 0 });
    return byHome.get(slug)!;
  };
  const ensureRoom = (h: HomeBucket, slug: string) => {
    let r = h.rooms.find(r => r.slug === slug);
    if (!r) { r = { slug, plain: [], groups: [] }; h.rooms.push(r); }
    return r;
  };

  for (const entry of topics) {
    const [topic, msg] = entry;
    const p = topic.split('/');
    const isHomecast = p[0] === 'homecast';
    const homeSlug = opts.groupByHome && isHomecast && p.length >= 2 ? p[1] : '';
    const roomSlug = opts.groupByRoom && isHomecast && p.length >= 4 ? p[2] : '';
    const isGroup = !!groupMembers[topic];

    const h = ensureHome(homeSlug);
    h.allTopicCount += 1;

    if (opts.groupByRoom && roomSlug) {
      const r = ensureRoom(h, roomSlug);
      if (isGroup) r.groups.push(buildGroup(topic, msg));
      else r.plain.push(entry);
    } else {
      // No room segment — park at the home level
      if (isGroup) h.groups.push(buildGroup(topic, msg));
      else h.plain.push(entry);
    }
  }

  const arr = Array.from(byHome.values());
  arr.sort((a, b) => (!a.slug ? 1 : !b.slug ? -1 : a.slug.localeCompare(b.slug)));
  for (const h of arr) {
    h.rooms.sort((a, b) => (!a.slug ? 1 : !b.slug ? -1 : a.slug.localeCompare(b.slug)));
    for (const r of h.rooms) r.groups.sort((a, b) => a.topic.localeCompare(b.topic));
    h.groups.sort((a, b) => a.topic.localeCompare(b.topic));
  }
  return arr;
}
