/**
 * The stages of the How it Works diagram, and the measured-arrow layer that
 * draws the rail between them. ArchitectureDiagram composes these for lg and
 * up; MobileFlow stacks them for everything narrower.
 */
import { useLayoutEffect, useState, type JSX, type ReactNode, type Ref, type RefObject } from 'react';
import { Lightbulb, Lock, Thermometer, DoorOpen, Speaker, Laptop, Cloud, Bell } from 'lucide-react';
import { HomecastMark } from '@/components/HomecastMark';
import { OPTION, OptionHeader, type Opt } from '@/components/marketing/pricing/plans';
import { DashboardDemo, MobileDashboardDemo, useHomeState } from '@/components/marketing/landing/demos';
import type { Home } from '@/components/marketing/landing/demos/home-state';
import { GraphQLLogo, RestLogo, MCPLogo, AppleTVIcon, HomePodIcon, MacMiniIcon } from './icons';

export const STEPS: Record<Opt, { steps: string[]; best: string }> = {
  1: { steps: ['Install the Homecast Mac app', 'Keep your Mac awake with the app running'], best: 'always-on Mac mini or MacBook' },
  2: { steps: ['Sign up for Cloud Relay', 'Invite Homecast to your Apple Home'], best: 'no Mac available · Apple Home Hub required' },
};

export function DevicesHouse({ innerRef, className = '' }: { innerRef?: Ref<HTMLDivElement>; className?: string }) {
  return (
    <div className={`relative flex h-[60px] w-[56px] items-center justify-center ${className}`}>
      <div ref={innerRef} className="absolute inset-0" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 72 80" fill="none">
        <path d="M36 4 L68 28 C70 29.5 71 31 71 33 L71 70 C71 74 68 77 64 77 L8 77 C4 77 1 74 1 70 L1 33 C1 31 2 29.5 4 28 L36 4Z" className="fill-background stroke-border" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className="relative mt-1 flex flex-col items-center">
        <div className="mb-0.5"><Lightbulb className="h-3.5 w-3.5 text-amber-500" /></div>
        <div className="mb-0.5 flex gap-2"><Lock className="h-3.5 w-3.5 text-green-500" /><Thermometer className="h-3.5 w-3.5 text-blue-500" /></div>
        <div className="flex gap-2"><DoorOpen className="h-3.5 w-3.5 text-orange-500" /><Speaker className="h-3.5 w-3.5 text-violet-500" /></div>
      </div>
    </div>
  );
}

export function HubIcon({ innerRef }: { innerRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={innerRef} className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background p-2">
      <img src="/homekit_logo.png" alt="HomeKit" className="h-8 w-8" />
    </div>
  );
}

export function HubDevices() {
  return (
    <div className="mt-2 flex gap-3">
      <div className="flex flex-col items-center"><AppleTVIcon /><span className="text-[9px] text-muted-foreground">Apple TV</span></div>
      <div className="flex flex-col items-center"><HomePodIcon /><span className="text-[9px] text-muted-foreground">HomePod</span></div>
    </div>
  );
}

export function RelayIcon({ innerRef, size = 14 }: { innerRef?: Ref<HTMLDivElement>; size?: 12 | 14 }) {
  return (
    <div ref={innerRef} className={`flex ${size === 14 ? 'h-14 w-14' : 'h-12 w-12'} items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/25`}>
      <HomecastMark className="h-6 w-6 text-primary-foreground" />
    </div>
  );
}

/** The option card from the live page: header, two numbered steps, "Best for". */

export function OptionCard({ n, innerRef, className = '', compact = false }: { n: Opt; innerRef?: Ref<HTMLDivElement>; className?: string; compact?: boolean }) {
  const o = OPTION[n];
  return (
    <div ref={innerRef} className={`flex-1 rounded-2xl bg-slate-50 dark:bg-slate-800/30 ${compact ? 'p-4' : 'p-6'} ${className}`}>
      <div className="mb-4"><OptionHeader n={n} compact={compact} /></div>
      <div className="mb-4 space-y-3">
        {STEPS[n].steps.map((s, i) => (
          <div key={s} className="flex gap-3">
            <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${n === 1 ? 'bg-primary' : 'bg-blue-500'}`}>{i + 1}</div>
            <p className="text-sm">{s}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-3 text-xs text-muted-foreground">Best for: {STEPS[n].best}</div>
    </div>
  );
}

/** The two option cards side by side, as on the live page (below lg they stack). */

export function OptionCards({ refs, className = '' }: { refs?: [Ref<HTMLDivElement>, Ref<HTMLDivElement>]; className?: string }) {
  return (
    <div className={`flex flex-col items-stretch gap-4 md:flex-row ${className}`}>
      <OptionCard n={1} innerRef={refs?.[0]} />
      <div className="flex shrink-0 items-center justify-center text-sm font-medium text-muted-foreground">or</div>
      <OptionCard n={2} innerRef={refs?.[1]} />
    </div>
  );
}

/** A column of the flow: the icon on a fixed-height row (so every stage's icon centre is at the same y), then a label, then anything else. */

export function Stage({ icon, label, big, children, className = '' }: { icon: ReactNode; label: string; big?: boolean; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="flex h-[72px] items-center justify-center">{icon}</div>
      <span className={`mt-3 whitespace-nowrap font-medium ${big ? 'text-base' : 'text-sm'}`}>{label}</span>
      {children}
    </div>
  );
}

export interface Arrow { d: string; head?: string; dashed?: boolean; width?: number; cap?: 'round' | 'butt' }

/** Measures the given elements relative to the container and hands their rects to `compute`; re-runs on resize. */

export function useArrows(container: RefObject<HTMLDivElement>, compute: (rect: (el: HTMLElement | null) => DOMRect | null) => Arrow[]) {
  const [arrows, setArrows] = useState<Arrow[]>([]);
  useLayoutEffect(() => {
    const run = () => {
      const c = container.current;
      if (!c) return;
      const box = c.getBoundingClientRect();
      const rect = (el: HTMLElement | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return new DOMRect(r.left - box.left, r.top - box.top, r.width, r.height);
      };
      setArrows(compute(rect));
    };
    run();
    window.addEventListener('resize', run);
    return () => window.removeEventListener('resize', run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return arrows;
}

export function ArrowLayer({ arrows, className = 'text-muted-foreground/50' }: { arrows: Arrow[]; className?: string }) {
  return (
    <svg className={`pointer-events-none absolute inset-0 overflow-visible ${className}`} style={{ width: '100%', height: '100%' }}>
      {arrows.map((a, i) => (
        <g key={i}>
          <path d={a.d} stroke="currentColor" strokeWidth={a.width ?? 1.5} strokeLinecap={a.cap} strokeDasharray={a.dashed ? '4 3' : undefined} fill="none" />
          {a.head && <polygon fill="currentColor" points={a.head} />}
        </g>
      ))}
    </svg>
  );
}

/** The front page's own dashboard renders, at thumbnail size: a landscape desktop for the web, a portrait phone for iOS and Android. */

function AppThumb({ kind, label, home, size = 'md' }: { kind: 'web' | 'ios' | 'android'; label: string; home: Home; size?: 'md' | 'sm' }) {
  const w = size === 'md' ? { web: 'w-[100px]', phone: 'w-[36px]' } : { web: 'w-[80px]', phone: 'w-[28px]' };
  const frame = kind === 'web' ? `${w.web} rounded-md` : kind === 'ios' ? `${w.phone} rounded-[7px]` : `${w.phone} rounded-[4px]`;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`pointer-events-none overflow-hidden border border-border shadow-sm [&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none ${frame}`}>
        {kind === 'web' ? <DashboardDemo home={home} /> : <MobileDashboardDemo home={home} />}
      </div>
      <span className="text-[9px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

const API_ITEMS: [() => JSX.Element, string][] = [[GraphQLLogo, 'GraphQL'], [RestLogo, 'REST'], [MCPLogo, 'MCP'], [() => <Bell className="h-6 w-6 text-amber-500" />, 'Webhooks']];

/** The APIs as a row of logos with names beneath — the same treatment as Mac mini / MacBook under the relay. */

export function ApiIcons() {
  return (
    <div className="flex gap-4">
      {API_ITEMS.map(([Logo, name]) => (
        <div key={name} className="flex flex-col items-center gap-0.5"><Logo /><span className="text-[9px] text-muted-foreground">{name}</span></div>
      ))}
    </div>
  );
}

/**
 * The last stage — no box. Either the app icon sits on the rail with the platform renders beneath,
 * or (`thumbsOnRail`) the renders themselves sit on the rail as the stage's marker.
 */

export function AppsStage({ boxRef, markerRef, thumbsOnRail = false }: {
  boxRef?: Ref<HTMLDivElement>; markerRef?: Ref<HTMLDivElement>; thumbsOnRail?: boolean;
}) {
  const home = useHomeState();
  const thumbs = (size: 'md' | 'sm') => (
    <>
      <AppThumb kind="web" label="Web" home={home} size={size} />
      <AppThumb kind="ios" label="iOS" home={home} size={size} />
      <AppThumb kind="android" label="Android" home={home} size={size} />
    </>
  );
  return (
    <div ref={boxRef} className="flex flex-col items-center">
      <div className="flex h-[72px] items-center justify-center">
        {thumbsOnRail ? (
          <div ref={markerRef} className="flex items-end gap-3">{thumbs('sm')}</div>
        ) : (
          <div ref={markerRef} className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/25">
            <HomecastMark className="h-6 w-6 text-primary-foreground" />
          </div>
        )}
      </div>
      <span className="mt-3 whitespace-nowrap text-sm font-medium">Homecast App</span>
      {!thumbsOnRail && <div className="mt-2 flex items-end gap-4">{thumbs('md')}</div>}
      <span className="mt-4 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">APIs</span>
      <div className="mt-1.5"><ApiIcons /></div>
    </div>
  );
}

export function AppsApisCard({ innerRef, className = '' }: { innerRef?: Ref<HTMLDivElement>; className?: string }) {
  const row = 'flex items-center gap-2';
  const home = useHomeState();
  return (
    <div ref={innerRef} className={`rounded-2xl border border-border bg-background shadow-sm ${className}`}>
      <div className="flex flex-col gap-2 p-3">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Apps</span>
        <div className={row}>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/80 shadow-sm shadow-primary/25"><HomecastMark className="h-4 w-4 text-primary-foreground" /></div>
          <span className="text-[11px] font-semibold">Homecast App</span>
        </div>
        <div className="mt-1.5 flex items-end justify-center gap-5">
          <AppThumb kind="web" label="Web" home={home} />
          <AppThumb kind="ios" label="iOS" home={home} />
          <AppThumb kind="android" label="Android" home={home} />
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-border p-3">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">APIs</span>
        <div className={row}><GraphQLLogo /><span className="text-[10px] font-medium">GraphQL</span></div>
        <div className={row}><RestLogo /><span className="text-[10px] font-medium">REST API</span></div>
        <div className={row}><MCPLogo /><span className="text-[10px] font-medium">MCP</span></div>
        <div className={row}><Bell className="h-5 w-5 text-amber-500" /><span className="text-[10px] font-medium">Webhooks</span></div>
      </div>
    </div>
  );
}

export const DownArrow = () => <svg className="h-5 w-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>;

export function MobileFlow({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 lg:hidden">
      <div className="flex max-w-[200px] flex-col items-center gap-2"><DevicesHouse className="scale-125" /><span className="mt-3 text-base font-medium">Your Smart Devices</span></div>
      <DownArrow />
      <div className="flex flex-col items-center gap-2"><HubIcon /><span className="text-base font-medium">Apple Home Hub</span></div>
      <DownArrow />
      <div className="flex flex-col items-center gap-2"><RelayIcon /><span className="text-base font-medium">Homecast Relay</span><p className="text-center text-[11px] text-muted-foreground">Option 1: run on your own Mac. Option 2: let us host it for you.</p></div>
      <DownArrow />
      <AppsApisCard className="w-[200px]" />
      {children}
    </div>
  );
}
