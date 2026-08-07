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
import { PRESET_IMAGES } from '@/lib/colorUtils';
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

  const displayed = settings;
  const { hasBackground, isDarkBackground } = useBackgroundDarkness(displayed, bgImageLuminance);

  useEffect(() => { if (runId) mark(`isDarkBackground -> ${isDarkBackground}`); }, [isDarkBackground]); // eslint-disable-line
  useEffect(() => { if (runId && bgImageLuminance != null) mark(`luminance -> ${bgImageLuminance.toFixed(3)}`); }, [bgImageLuminance]); // eslint-disable-line

  const ctx = useMemo(() => ({ hasBackground, isDarkBackground }), [hasBackground, isDarkBackground]);

  return (
    <BackgroundContext.Provider value={ctx}>
      <div className="relative bg-background" style={{ minHeight: '100vh' }}>
        <BackgroundImage
          key={runId}
          settings={displayed}
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
          <button className="px-3 py-1 rounded bg-blue-600 font-semibold" onClick={() => setRunId(n => n + 1)}>
            ▶ replay load
          </button>
          <span className="opacity-70">
            hasBackground={String(hasBackground)} isDark={String(isDarkBackground)} lum={bgImageLuminance?.toFixed(3) ?? '—'}
          </span>
        </div>

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

        <pre className="relative z-10 m-4 p-3 rounded bg-black/85 text-green-300 text-[11px] leading-relaxed overflow-auto max-h-56">
{events.length ? events.join('\n') : 'press replay'}
        </pre>
      </div>
    </BackgroundContext.Provider>
  );
}
