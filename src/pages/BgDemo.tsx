/**
 * Dev-only harness for the wallpaper-load → widget-recolour sequence.
 *
 * This is NOT an approximation: it renders the real BackgroundImage, the real
 * useBackgroundDarkness, and the real WidgetWrapper through the real
 * BackgroundContext, wired exactly as Dashboard wires them. The whole point is
 * that a hand-written mock of the layer stack reproduces whatever you already
 * believed, which is worthless for finding out what actually snaps.
 *
 * Reached at /bgdemo, dev builds only (see App.tsx).
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { BackgroundImage } from '@/components/BackgroundImage';
import { useBackgroundDarkness } from '@/hooks/useBackgroundDarkness';
import { BackgroundContext } from '@/contexts/BackgroundContext';
import { WidgetWrapper } from '@/components/widgets/WidgetWrapper';
import { PRESET_IMAGES, getAutoPresetId } from '@/lib/colorUtils';
import type { BackgroundSettings } from '@/lib/graphql/types';

const TILES = [
  ['💡', 'Ceiling', 'Off'], ['🌡️', 'Thermostat', '21°C'], ['🔒', 'Front Door', 'Locked'],
  ['💡', 'Lamp', 'Off'], ['🌀', 'Fan', 'Off'], ['📷', 'Camera', 'Idle'],
];

export default function BgDemo() {
  const presetIds = Object.keys(PRESET_IMAGES);
  const [presetId, setPresetId] = useState(presetIds[2] ?? presetIds[0]);
  // Dashboard starts with no background and gets one once layout data lands.
  // 0 = present at mount (no crossfade), >0 = arrives later (crossfade path).
  const [arriveMs, setArriveMs] = useState(600);
  const [bust, setBust] = useState(true);
  const [runId, setRunId] = useState(0);
  // Dashboard defaults autoBackgrounds to true and passes entityId, so its
  // BackgroundImage always has an auto-preset in currentBg — which means a real
  // background (or a room switch) is always a CROSSFADE, never a cold start.
  const [autoBg, setAutoBg] = useState(true);
  const [entityIdx, setEntityIdx] = useState(0);
  const ENTITIES = ['room-kitchen', 'room-lounge', 'room-bedroom'];
  const rootRef = useRef<HTMLDivElement>(null);
  // Reproduces the Dashboard entrance animation that killed the widget glass.
  const [entrance, setEntrance] = useState(false);
  const [entranceMs, setEntranceMs] = useState(4000);
  const [entranceRun, setEntranceRun] = useState(0);
  const [settings, setSettings] = useState<BackgroundSettings | null>(null);
  const [bgImageLuminance, setBgImageLuminance] = useState<number | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const t0 = useRef(0);

  const mark = (s: string) =>
    setEvents(e => [...e, `${(performance.now() - t0.current).toFixed(0).padStart(6)}ms  ${s}`]);

  // Replay: clear everything, then deliver the settings the way Dashboard does.
  useEffect(() => {
    if (!runId) return;
    t0.current = performance.now();
    setEvents([]);
    setSettings(null);
    setBgImageLuminance(null);
    // Cache-bust via customUrl to force a genuine cold decode. It must be
    // absolute — toAbsoluteUrl() prefixes anything not starting with http with
    // the cloud API origin, which would 404 against the dev server.
    const next: BackgroundSettings = bust
      ? {
          type: 'custom',
          customUrl: `${window.location.origin}${PRESET_IMAGES[presetId]}?v=${runId}`,
          blur: 20,
          brightness: 50,
        }
      : { type: 'preset', presetId, blur: 20, brightness: 50 };
    const id = setTimeout(() => { mark('settings delivered'); setSettings(next); }, arriveMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Count the live BackgroundLayer children — a crossfade stacks two, and the
  // outgoing one is dropped 500ms later. If the widget backdrop changes style
  // "when the animation completes", that removal is a prime suspect.
  useEffect(() => {
    if (!runId) return;
    let last = -1;
    const id = setInterval(() => {
      const root = rootRef.current?.querySelector('[aria-hidden="true"]');
      const n = root ? root.children.length : -1;
      if (n !== last) { last = n; mark(`background layers in DOM: ${n}`); }
    }, 16);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Mirror Dashboard's displayedBackground: auto-presets are resolved OUTSIDE
  // BackgroundImage too, because useBackgroundDarkness has to see the same
  // background that is actually being painted. Passing the raw settings here
  // leaves hasBackground false while a wallpaper is plainly on screen.
  const displayed = useMemo((): BackgroundSettings | null => {
    if (settings && (settings.type === 'preset' || settings.type === 'custom')) return settings;
    if (autoBg && ENTITIES[entityIdx]) {
      return { type: 'preset', presetId: getAutoPresetId(ENTITIES[entityIdx]), blur: 10, brightness: 50 };
    }
    return settings;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, autoBg, entityIdx]);

  const { hasBackground, isDarkBackground, effectiveLuminance } = useBackgroundDarkness(displayed, bgImageLuminance);

  useEffect(() => { if (runId) mark(`isDarkBackground -> ${isDarkBackground}`); }, [isDarkBackground]); // eslint-disable-line
  useEffect(() => { if (runId && bgImageLuminance != null) mark(`luminance -> ${bgImageLuminance.toFixed(3)}`); }, [bgImageLuminance]); // eslint-disable-line

  const ctx = useMemo(() => ({ hasBackground, isDarkBackground, effectiveLuminance }), [hasBackground, isDarkBackground, effectiveLuminance]);

  return (
    <BackgroundContext.Provider value={ctx}>
      <div ref={rootRef} className="relative bg-background" style={{ minHeight: '100vh' }}>
        <BackgroundImage
          key={runId}
          settings={displayed}
          entityId={ENTITIES[entityIdx]}
          autoBackgroundsEnabled={autoBg}
          onReady={() => mark('onReady (background visible)')}
          onLuminanceChange={setBgImageLuminance}
        />

        <div className="relative z-10 p-3 flex flex-wrap items-center gap-3 bg-black/80 text-white text-xs font-mono">
          <strong>bgdemo</strong>
          <label className="flex items-center gap-1">
            preset
            <select className="text-black px-1 py-0.5 rounded" value={presetId} onChange={e => setPresetId(e.target.value)}>
              {presetIds.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            settings arrive
            <select className="text-black px-1 py-0.5 rounded" value={arriveMs} onChange={e => setArriveMs(+e.target.value)}>
              <option value={0}>at mount (no crossfade)</option>
              <option value={600}>after 600ms (crossfade)</option>
              <option value={2000}>after 2s</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={bust} onChange={e => setBust(e.target.checked)} />
            cold decode (cache-bust)
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={autoBg} onChange={e => setAutoBg(e.target.checked)} />
            autoBackgrounds (Dashboard default: on)
          </label>
          <button className="px-3 py-1 rounded bg-blue-600 font-semibold" onClick={() => setRunId(n => n + 1)}>
            ▶ replay load
          </button>
          <button className="px-3 py-1 rounded bg-purple-600 font-semibold"
                  onClick={() => { t0.current = performance.now(); setEvents([]); setEntityIdx(i => (i + 1) % ENTITIES.length); }}>
            ⇄ switch room ({ENTITIES[entityIdx]})
          </button>
          <label className="flex items-center gap-1 text-yellow-300">
            <input type="checkbox" checked={entrance}
                   onChange={e => { setEntrance(e.target.checked); setEntranceRun(n => n + 1); }} />
            entrance animation (THE BUG)
          </label>
          <label className="flex items-center gap-1">
            over
            <select className="text-black px-1 py-0.5 rounded" value={entranceMs} onChange={e => setEntranceMs(+e.target.value)}>
              <option value={350}>350ms (real)</option>
              <option value={4000}>4s (watchable)</option>
            </select>
          </label>
          <button className="px-3 py-1 rounded bg-amber-600 font-semibold" onClick={() => setEntranceRun(n => n + 1)}>
            ↻ replay entrance
          </button>
          <span className="opacity-70">
            hasBackground={String(hasBackground)} isDark={String(isDarkBackground)} lum={bgImageLuminance?.toFixed(3) ?? '—'}
          </span>
        </div>

        {/* The keyframe lives here, not in index.css, precisely so it can't be
            reapplied to a real glass ancestor. This is the bug on a switch:
            opacity (or transform) on an ancestor of a backdrop-filter element
            establishes a new backdrop root, so the tiles lose their blur
            entirely and show the wallpaper sharp until the animation ends. */}
        <style>{`@keyframes bgdemo-fade-slide-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }`}</style>

        <div
          key={`entrance-${entranceRun}`}
          style={entrance ? { animation: `bgdemo-fade-slide-in ${entranceMs}ms ease-out` } : undefined}
        >
          <div className="relative z-10 p-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))' }}>
            {TILES.map(([icon, title, sub]) => (
              <WidgetWrapper key={title} isOn={false}>
                <div className="p-4">
                  <div className="h-9 w-9 rounded-full bg-slate-200 flex items-center justify-center mb-2">{icon}</div>
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </div>
              </WidgetWrapper>
            ))}
          </div>
        </div>

        <pre className="relative z-10 m-4 p-3 rounded bg-black/85 text-green-300 text-[11px] leading-relaxed overflow-auto max-h-56">
{events.length ? events.join('\n') : 'press replay'}
        </pre>
      </div>
    </BackgroundContext.Provider>
  );
}
