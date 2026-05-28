import { useState, useEffect } from 'react';

const RANGES: Record<string, { min: number; max: number }> = {
  brightness: { min: 0, max: 100 }, color_temp: { min: 50, max: 500 },
  hue: { min: 0, max: 360 }, saturation: { min: 0, max: 100 },
  speed: { min: 0, max: 100 }, target: { min: 0, max: 100 },
  heatTarget: { min: 10, max: 38 }, coolTarget: { min: 10, max: 38 },
  volume: { min: 0, max: 100 }, battery: { min: 0, max: 100 },
};
const BOOLS = new Set(['on', 'active', 'mute', 'motion', 'contact', 'locked']);

// Priority order for the single boolean lifted onto the row.
const BOOL_PRIORITY = ['on', 'active', 'locked', 'mute'];
// Priority order for the single numeric slider lifted onto the row.
// Sensors (battery/temperature/humidity) are deliberately excluded — they're
// read-only, not actionable.
const NUMERIC_PRIORITY = ['brightness', 'speed', 'heatTarget', 'coolTarget', 'target', 'volume'];

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function parsePayload(payload: string): Record<string, unknown> | null {
  try { const p = JSON.parse(payload); return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null; }
  catch { return null; }
}

export function pickPrimaryBool(payload: string): string | null {
  const p = parsePayload(payload); if (!p) return null;
  // Only actionable booleans get an inline toggle. Sensor-style booleans
  // (motion, contact) live in BOOLS for type detection but aren't surfaced
  // on the row — they're read-only and shown via FmtVal instead.
  for (const k of BOOL_PRIORITY) if (k in p && (typeof p[k] === 'boolean' || p[k] === 0 || p[k] === 1)) return k;
  return null;
}

export function pickPrimaryNumeric(payload: string): string | null {
  const p = parsePayload(payload); if (!p) return null;
  for (const k of NUMERIC_PRIORITY) if (k in p && typeof p[k] === 'number' && RANGES[k]) return k;
  return null;
}

export function getRange(name: string): { min: number; max: number } | undefined {
  return RANGES[name];
}

// --- Reusable inline primitives -----------------------------------------

export function InlineToggle({ name, value, onPublish, compact }: { name: string; value: unknown; onPublish: (k: string, v: unknown) => void; compact?: boolean }) {
  const [localVal, setLocalVal] = useState<boolean>(value === true || value === 1);
  useEffect(() => { setLocalVal(value === true || value === 1); }, [value]);
  const stop = (e: React.MouseEvent | React.TouchEvent) => { e.stopPropagation(); };
  const size = compact ? 'w-8 h-[16px]' : 'w-9 h-[18px]';
  const knob = compact ? 'w-[12px] h-[12px]' : 'w-[14px] h-[14px]';
  const knobOn = compact ? 'left-[18px]' : 'left-[19px]';
  const knobOff = 'left-[2px]';
  return (
    <button onClick={(e) => { stop(e); const nv = !localVal; setLocalVal(nv); onPublish(name, nv); }}
      onMouseDown={stop}
      title={name}
      className={`relative ${size} rounded-full transition-colors shrink-0 ${localVal ? 'bg-green-500' : 'bg-muted-foreground/30'}`}>
      <span className={`absolute top-[2px] ${knob} rounded-full bg-white shadow transition-transform ${localVal ? knobOn : knobOff}`} />
    </button>
  );
}

export function InlineSlider({ name, value, onPublish, compact }: { name: string; value: number; onPublish: (k: string, v: unknown) => void; compact?: boolean }) {
  const [localVal, setLocalVal] = useState<number>(value);
  useEffect(() => { setLocalVal(value); }, [value]);
  const range = RANGES[name];
  if (!range) return null;
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };
  return (
    <div className="flex items-center gap-1.5 min-w-0 w-full" onClick={stop} onMouseDown={stop} onTouchStart={stop}>
      <input
        type="range" min={range.min} max={range.max} value={localVal}
        onChange={(e) => setLocalVal(Number(e.target.value))}
        onMouseUp={() => onPublish(name, localVal)}
        onTouchEnd={() => onPublish(name, localVal)}
        onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) onPublish(name, localVal); }}
        title={name}
        className="flex-1 min-w-0 h-1 accent-primary cursor-pointer"
      />
      <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-8 text-right shrink-0">{localVal}</span>
    </div>
  );
}

// --- Detail-panel editor (uses the inline primitives) -------------------

export function PropertyEditor({ payload, onPublish }: { payload: string; onPublish: (k: string, v: unknown) => void }) {
  let props: Record<string, string | number | boolean> = {};
  try { props = JSON.parse(payload); } catch { return <p className="text-xs text-muted-foreground">Cannot parse</p>; }
  return <div className="space-y-1">{Object.entries(props).map(([k, v]) => <PropRow key={k} name={k} value={v} onPublish={onPublish} />)}</div>;
}

function PropRow({ name, value, onPublish }: { name: string; value: string | number | boolean; onPublish: (k: string, v: unknown) => void }) {
  const [localVal, setLocalVal] = useState(value);
  useEffect(() => { setLocalVal(value); }, [value]);

  const isBool = BOOLS.has(name) || typeof value === 'boolean';
  const isNum = typeof value === 'number' && !isBool;
  const range = RANGES[name];

  if (isBool) {
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-xs text-muted-foreground">{name}</span>
        <InlineToggle name={name} value={value} onPublish={onPublish} />
      </div>
    );
  }

  if (isNum && range) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-xs text-muted-foreground w-20 shrink-0">{name}</span>
        <input type="range" min={range.min} max={range.max} value={Number(localVal)}
          onChange={(e) => setLocalVal(Number(e.target.value))}
          onMouseUp={() => onPublish(name, localVal)}
          onTouchEnd={() => onPublish(name, localVal)}
          className="flex-1 h-1 accent-primary cursor-pointer" />
        <input type="number" value={Number(localVal)} min={range.min} max={range.max}
          onChange={(e) => setLocalVal(Number(e.target.value))}
          onBlur={() => onPublish(name, localVal)}
          onKeyDown={(e) => { if (e.key === 'Enter') onPublish(name, localVal); }}
          className="w-12 text-[11px] font-mono text-right bg-background border rounded px-1 py-0.5 outline-none focus:border-primary" />
      </div>
    );
  }

  if (isNum) {
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-xs text-muted-foreground">{name}</span>
        <input type="number" value={Number(localVal)} onChange={(e) => setLocalVal(Number(e.target.value))}
          onBlur={() => onPublish(name, localVal)}
          onKeyDown={(e) => { if (e.key === 'Enter') onPublish(name, localVal); }}
          className="w-16 text-[11px] font-mono text-right bg-background border rounded px-1 py-0.5 outline-none focus:border-primary" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{name}</span>
      <input type="text" value={String(localVal)} onChange={(e) => setLocalVal(e.target.value)}
        onBlur={() => onPublish(name, localVal)}
        onKeyDown={(e) => { if (e.key === 'Enter') onPublish(name, localVal); }}
        className="w-28 text-[11px] font-mono bg-background border rounded px-1 py-0.5 outline-none focus:border-primary" />
    </div>
  );
}

export function TopicPath({ topic, short }: { topic: string; short?: boolean }) {
  const p = topic.split('/');
  if (p[0] === 'homecast' && p.length >= 4) {
    if (short) return <span className="text-foreground">{p.slice(3).join('/')}</span>;
    return <><span className="text-blue-500">{p[1]}</span>/<span className="text-purple-400">{p[2]}</span>/<span className="text-foreground">{p.slice(3).join('/')}</span></>;
  }
  return <>{topic}</>;
}

export function FmtVal({ payload, omitKeys }: { payload: string; omitKeys?: string[] }) {
  try {
    const obj = JSON.parse(payload);
    const skip = new Set(omitKeys || []);
    const entries = Object.entries(obj).filter(([k]) => !skip.has(k));
    if (entries.length === 0) return null;
    return <>{entries.map(([k, v], i) => (
      <span key={k}>
        {i > 0 && <span className="text-muted-foreground"> · </span>}
        <span className="text-muted-foreground">{k}: </span>
        {v === true ? <span className="text-green-500">on</span> : v === false ? <span className="text-red-400">off</span> : typeof v === 'number' ? <span className="text-amber-400">{v}</span> : <span>{String(v)}</span>}
      </span>
    ))}</>;
  } catch { return <>{payload}</>; }
}
