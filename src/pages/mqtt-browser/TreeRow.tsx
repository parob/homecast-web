import { TopicPath, FmtVal, TypeBadge, AccessoryTypeIcon } from './helpers';
import type { TopicMessage, MqttRowType } from './topic-tree';

interface TreeRowProps {
  topic: string;
  message: TopicMessage;
  effectivePayload: string;
  availability?: string; // 'online' | 'offline' | undefined
  rowType: MqttRowType;
  indentPx: number;
  shortPath?: boolean;
  selected: boolean;
  onSelect: (topic: string) => void;
}

/** Key for a topic row — includes the timestamp while fresh so the row
 *  remounts and the flash animation restarts on every update. */
export function rowKey(topic: string, message: TopicMessage): string {
  return Date.now() - message.timestamp < 8000 ? `${topic}-${message.timestamp}` : topic;
}

// Read-only leaf row: availability dot, type icon + badge, topic path,
// live value summary and timestamp. Clicking selects the topic for the
// inspector — rows never expand in place.
export function TreeRow({ topic, message, effectivePayload, availability, rowType, indentPx, shortPath, selected, onSelect }: TreeRowProps) {
  const isOffline = availability === 'offline';
  const isRecent = Date.now() - message.timestamp < 8000;
  return (
    <div
      role="button" tabIndex={0}
      onClick={() => onSelect(topic)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(topic); } }}
      className={`w-full flex items-center gap-2 pr-3 py-1.5 text-left hover:bg-muted/50 cursor-pointer ${selected ? 'bg-primary/10 shadow-[inset_2px_0_0_0_hsl(var(--primary))]' : ''} ${isOffline ? 'opacity-40' : ''} ${isRecent ? 'animate-mqtt-flash' : ''}`}
      style={{ paddingLeft: Math.max(indentPx, 12) }}
    >
      {availability && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOffline ? 'bg-muted-foreground/50' : 'bg-green-500'}`} />}
      <AccessoryTypeIcon payload={effectivePayload} />
      <TypeBadge type={rowType} />
      <span className="font-mono text-xs text-muted-foreground min-w-0 truncate">
        <TopicPath topic={topic} short={shortPath} />
      </span>
      {message.updates > 1 && <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{message.updates} updates</span>}
      <span className="ml-auto flex items-center gap-2 min-w-0">
        <span className="font-mono text-[11px] text-right truncate min-w-0"><FmtVal payload={effectivePayload} /></span>
        <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      </span>
    </div>
  );
}
