import { ChevronDown, ChevronRight } from 'lucide-react';
import { TypeBadge, AccessoryTypeIcon, FmtVal } from './helpers';
import { TreeRow, rowKey } from './TreeRow';
import { rowTypeForTopic } from './topic-tree';
import type { HomeBucket, RoomBucket, GroupBucket, TopicMessage } from './topic-tree';

// Shared context threaded through the section components — cheaper than
// ten individual props at every level.
interface TreeCtx {
  groupByRoom: boolean;
  openHomes: Set<string>;
  openRooms: Set<string>; // keyed `${homeSlug}/${roomSlug}`
  openGroups: Set<string>; // keyed by group topic
  onToggleHome: (slug: string) => void;
  onToggleRoom: (key: string) => void;
  onToggleGroup: (topic: string) => void;
  selectedTopic: string | null;
  onSelect: (topic: string) => void;
  availability: Record<string, string>;
  groupMembers: Record<string, string[]>;
  getEffectivePayload: (topic: string, payload: string) => string;
}

// Pluralize and join: [[3, 'device'], [1, 'group']] → "3 devices · 1 group"
const fmtCounts = (parts: Array<[number, string]>) =>
  parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`).join(' · ');

const SELECTED_ROW = 'bg-primary/10 shadow-[inset_2px_0_0_0_hsl(var(--primary))]';

function LeafRows({ entries, indentPx, shortPath, ctx }: { entries: Array<[string, TopicMessage]>; indentPx: number; shortPath?: boolean; ctx: TreeCtx }) {
  return (
    <>
      {entries.map(([topic, m]) => (
        <TreeRow
          key={rowKey(topic, m)}
          topic={topic}
          message={m}
          effectivePayload={ctx.getEffectivePayload(topic, m.payload)}
          availability={ctx.availability[topic]}
          rowType={rowTypeForTopic(topic, ctx.groupMembers)}
          indentPx={indentPx}
          shortPath={shortPath}
          selected={ctx.selectedTopic === topic}
          onSelect={ctx.onSelect}
        />
      ))}
    </>
  );
}

// Group node: the chevron toggles member visibility, clicking anywhere else
// on the header selects the group for the inspector. Members stay visible
// while other topics are inspected — tree state and selection are decoupled.
function GroupNode({ g, headerDepth, ctx }: { g: GroupBucket; headerDepth: number; ctx: TreeCtx }) {
  const groupSlug = g.topic.split('/').pop() || g.topic;
  const ep = ctx.getEffectivePayload(g.topic, g.payload.payload);
  const headerPadLeft = 12 + headerDepth * 16;
  const isOpen = ctx.openGroups.has(g.topic);
  const selected = ctx.selectedTopic === g.topic;
  return (
    <div>
      <div
        role="button" tabIndex={0}
        onClick={() => ctx.onSelect(g.topic)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.onSelect(g.topic); } }}
        className={`w-full flex items-center justify-between pr-3 py-1.5 text-xs font-semibold text-left cursor-pointer hover:bg-muted/50 ${selected ? SELECTED_ROW : 'bg-muted/30'}`}
        style={{ paddingLeft: headerPadLeft }}
      >
        <span className="flex items-center justify-between gap-2 min-w-0 w-full">
          <span className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={(e) => { e.stopPropagation(); ctx.onToggleGroup(g.topic); }}
              onKeyDown={(e) => e.stopPropagation()}
              className="p-1 -m-1 rounded hover:bg-muted shrink-0"
              title={isOpen ? 'Hide members' : 'Show members'}
            >
              {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </button>
            <AccessoryTypeIcon payload={ep} />
            <TypeBadge type="group" />
            <span className="font-mono truncate">{groupSlug}</span>
          </span>
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[11px] font-normal text-right truncate min-w-0"><FmtVal payload={ep} /></span>
            <span className="text-[10px] text-muted-foreground font-normal tabular-nums shrink-0">{fmtCounts([[g.memberTopics.length, 'device']])}</span>
          </span>
        </span>
      </div>
      {isOpen && (
        <div className="divide-y border-l-2 border-border/50" style={{ marginLeft: headerPadLeft + 5 }}>
          <LeafRows entries={g.memberTopics} indentPx={12} shortPath ctx={ctx} />
        </div>
      )}
    </div>
  );
}

function RoomSection({ r, homeSlug, headerDepth, ctx }: { r: RoomBucket; homeSlug: string; headerDepth: number; ctx: TreeCtx }) {
  const body = (innerDepth: number) => (
    <>
      {r.groups.map(g => <GroupNode key={g.topic} g={g} headerDepth={innerDepth} ctx={ctx} />)}
      <LeafRows entries={r.plain} indentPx={innerDepth * 16 + 20} shortPath ctx={ctx} />
    </>
  );
  if (!r.slug) return <div className="divide-y">{body(headerDepth)}</div>;
  const roomKey = `${homeSlug}/${r.slug}`;
  const isOpen = ctx.openRooms.has(roomKey);
  const headerPadLeft = 12 + headerDepth * 16;
  return (
    <div>
      <button
        onClick={() => ctx.onToggleRoom(roomKey)}
        className="w-full flex items-center justify-between pr-3 py-1.5 bg-muted/30 hover:bg-muted/50 text-xs font-semibold"
        style={{ paddingLeft: headerPadLeft }}
      >
        <span className="flex items-center gap-1.5">
          {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <TypeBadge type="room" />
          <span className="font-mono">{r.slug}</span>
        </span>
        <span className="text-[10px] text-muted-foreground font-normal">{fmtCounts([[r.plain.length, 'device'], [r.groups.length, 'group']])}</span>
      </button>
      {isOpen && <div className="divide-y">{body(headerDepth + 1)}</div>}
    </div>
  );
}

function HomeBody({ h, rowDepth, ctx }: { h: HomeBucket; rowDepth: number; ctx: TreeCtx }) {
  return (
    <>
      {/* Groups first, then loose accessories, then rooms */}
      {h.groups.map(g => <GroupNode key={g.topic} g={g} headerDepth={rowDepth} ctx={ctx} />)}
      <LeafRows entries={h.plain} indentPx={rowDepth * 16 + (rowDepth > 0 ? 20 : 0)} shortPath={rowDepth > 0} ctx={ctx} />
      {ctx.groupByRoom && h.rooms.map(r => <RoomSection key={r.slug || '_noroom'} r={r} homeSlug={h.slug} headerDepth={rowDepth} ctx={ctx} />)}
    </>
  );
}

function HomeSection({ h, ctx }: { h: HomeBucket; ctx: TreeCtx }) {
  const isOpen = ctx.openHomes.has(h.slug);
  const homeDevices = h.plain.length + h.rooms.reduce((s, r) => s + r.plain.length, 0);
  const homeGroups = h.groups.length + h.rooms.reduce((s, r) => s + r.groups.length, 0);
  return (
    <div>
      <button
        onClick={() => ctx.onToggleHome(h.slug)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/20 hover:bg-muted/40 text-xs font-semibold"
      >
        <span className="flex items-center gap-1.5">
          {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <TypeBadge type="home" />
          <span className="font-mono">{h.slug}</span>
        </span>
        <span className="text-[10px] text-muted-foreground font-normal">
          {fmtCounts([[h.rooms.length, 'room'], [homeDevices, 'device'], [homeGroups, 'group']])}
        </span>
      </button>
      {isOpen && <div className="divide-y"><HomeBody h={h} rowDepth={1} ctx={ctx} /></div>}
    </div>
  );
}

interface TreePaneProps extends TreeCtx {
  tree: HomeBucket[];
  groupByHome: boolean;
}

export function TreePane({ tree, groupByHome, ...ctx }: TreePaneProps) {
  return (
    <div className="border rounded-lg overflow-hidden divide-y min-w-0">
      {tree.map(h => {
        if (!groupByHome || !h.slug) {
          return <div key={h.slug || '_flat'} className="divide-y"><HomeBody h={h} rowDepth={0} ctx={ctx} /></div>;
        }
        return <HomeSection key={h.slug} h={h} ctx={ctx} />;
      })}
    </div>
  );
}
