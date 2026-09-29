// @vitest-environment jsdom
//
// A row names only what the headers above it do not. Turning home or room
// grouping off used to leave rows — and every group header — without the home
// or room they belong to, because the path was trimmed by nesting depth rather
// than by which headers were actually on screen.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TreePane } from '../TreePane';
import { buildTopicTree, type TopicMessage } from '../topic-tree';

const HOME = 'county-hall-d08c';
const LIGHT = `homecast/${HOME}/living-a751/living-room-lamp-1a2b`;
const GROUP = `homecast/${HOME}/living-a751/living-room-lights-9f00`;
const MEMBER_ELSEWHERE = `homecast/${HOME}/hall-77aa/hall-lamp-3c4d`;
const ROOMLESS = `homecast/${HOME}/home-mode-80d9`;

const msg = (payload: object): TopicMessage => ({ payload: JSON.stringify(payload), timestamp: 0, updates: 1 });
const messages: Record<string, TopicMessage> = {
  [LIGHT]: msg({ on: true }),
  [GROUP]: msg({ on: true }),
  [MEMBER_ELSEWHERE]: msg({ on: false }),
  [ROOMLESS]: msg({ mode: 'Home' }),
};
const groupMembers = { [GROUP]: ['hall-lamp-3c4d'] };
const slugToTopic = new Map(Object.keys(messages).map(t => [t.split('/').pop()!, t]));

function rowText(groupByHome: boolean, groupByRoom: boolean): string[] {
  cleanup();
  const flat = !groupByHome && !groupByRoom;
  // What MQTTBrowser hands the pane: members nest under their group while
  // grouping, and are ordinary topics in the plain list.
  const all = Object.entries(messages).sort(([a], [b]) => a.localeCompare(b));
  const topics = flat ? all : all.filter(([t]) => t !== MEMBER_ELSEWHERE);
  const tree = buildTopicTree(topics, groupMembers, slugToTopic, messages, { groupByHome, groupByRoom });
  render(
    <TreePane
      tree={tree}
      flatTopics={flat ? topics : undefined}
      groupByHome={groupByHome}
      groupByRoom={groupByRoom}
      openHomes={new Set([HOME])}
      openRooms={new Set([`${HOME}/living-a751`, `${groupByHome ? HOME : ''}/living-a751`])}
      openGroups={new Set([GROUP])}
      onToggleHome={() => {}}
      onToggleRoom={() => {}}
      onToggleGroup={() => {}}
      selectedTopic={null}
      onSelect={() => {}}
      availability={{}}
      deviceInfo={{}}
      groupMembers={groupMembers}
      getEffectivePayload={(_t, p) => p}
    />,
  );
  // Topic names only — the value summaries share the monospace class.
  return [...document.querySelectorAll('.font-mono')].map(e => e.textContent || '').filter(t => !t.includes(':'));
}

describe('MQTT tree: rows name what their headers do not', () => {
  afterEach(cleanup);

  it('grouped by home and room: bare slugs under both headers', () => {
    const rows = rowText(true, true);
    expect(rows).toContain('living-room-lamp-1a2b');
    expect(rows).toContain('living-room-lights-9f00');
    // A member in another room keeps its room — the header above it is not its room.
    expect(rows).toContain('hall-77aa/hall-lamp-3c4d');
    expect(rows).toContain('home-mode-80d9');
  });

  it('room grouping off: every row keeps its room', () => {
    const rows = rowText(true, false);
    expect(rows).toContain('living-a751/living-room-lamp-1a2b');
    expect(rows).toContain('living-a751/living-room-lights-9f00');
    expect(rows).toContain('hall-77aa/hall-lamp-3c4d');
  });

  it('home grouping off: every row keeps its home', () => {
    const rows = rowText(false, true);
    expect(rows).toContain(`${HOME}/living-room-lamp-1a2b`);
    expect(rows).toContain(`${HOME}/living-room-lights-9f00`);
    expect(rows).toContain(`${HOME}/home-mode-80d9`);
  });

  it('no grouping: a plain topic list, fully qualified and in topic order', () => {
    const rows = rowText(false, false);
    expect(rows).toEqual([
      `homecast/${HOME}/hall-77aa/hall-lamp-3c4d`,
      `homecast/${HOME}/home-mode-80d9`,
      `homecast/${HOME}/living-a751/living-room-lamp-1a2b`,
      `homecast/${HOME}/living-a751/living-room-lights-9f00`,
    ]);
  });
});
