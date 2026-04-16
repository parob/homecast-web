import { useState, useEffect } from 'react';

const RANGES: Record<string, { min: number; max: number }> = {
  brightness: { min: 0, max: 100 }, color_temp: { min: 50, max: 500 },
  hue: { min: 0, max: 360 }, saturation: { min: 0, max: 100 },
  speed: { min: 0, max: 100 }, target: { min: 0, max: 100 },
  volume: { min: 0, max: 100 }, battery: { min: 0, max: 100 },
};
const BOOLS = new Set(['on', 'active', 'mute', 'motion', 'contact', 'locked']);

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

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
    const on = localVal === true || localVal === 1;
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-xs text-muted-foreground">{name}</span>
        <button onClick={() => { const nv = !on; setLocalVal(nv); onPublish(name, nv); }}
          className={`relative w-9 h-[18px] rounded-full transition-colors ${on ? 'bg-green-500' : 'bg-muted-foreground/30'}`}>
          <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${on ? 'left-[19px]' : 'left-[2px]'}`} />
        </button>
      </div>
    );
  }

  if (isNum && range) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-xs text-muted-foreground w-20 shrink-0">{name}</span>
        <input type="range" min={range.min} max={range.max} value={localVal}
          onChange={(e) => setLocalVal(Number(e.target.value))}
          onMouseUp={() => onPublish(name, localVal)}
          onTouchEnd={() => onPublish(name, localVal)}
          className="flex-1 h-1 accent-primary cursor-pointer" />
        <input type="number" value={localVal} min={range.min} max={range.max}
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
        <input type="number" value={localVal} onChange={(e) => setLocalVal(Number(e.target.value))}
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

export function FmtVal({ payload }: { payload: string }) {
  try {
    const obj = JSON.parse(payload);
    return <>{Object.entries(obj).map(([k, v], i) => (
      <span key={k}>
        {i > 0 && <span className="text-muted-foreground"> · </span>}
        <span className="text-muted-foreground">{k}: </span>
        {v === true ? <span className="text-green-500">on</span> : v === false ? <span className="text-red-400">off</span> : typeof v === 'number' ? <span className="text-amber-400">{v}</span> : <span>{String(v)}</span>}
      </span>
    ))}</>;
  } catch { return <>{payload}</>; }
}
