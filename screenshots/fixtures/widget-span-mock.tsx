/**
 * Mock only — not a test, not shipped. Renders the real WidgetCard and
 * CameraTilePreview at the three tile sizes proposed on homecast-cloud#154 so
 * the geometry can be looked at rather than described.
 *
 * The camera image is drawn here on a canvas: no private camera photograph.
 * Only the aspect ratio and the crop behaviour are real.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Video, Lock, ShieldCheck, Lightbulb } from 'lucide-react';
import { WidgetCard } from '../../src/components/widgets/WidgetCard';
import { CameraTilePreview } from '../../src/components/widgets/CameraTilePreview';
import {
  cameraSnapshotCacheGeneration,
  cameraSnapshotCacheKey,
  setCameraSnapshot,
  setCameraSnapshotAccount,
} from '../../src/lib/camera-snapshot-cache';
import '../../src/index.css';



/** A plausible porch-at-dusk view, so the crop can be judged. Synthetic. */
function drawPorch(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#22304a');
  sky.addColorStop(0.45, '#3d4a63');
  sky.addColorStop(1, '#171d29');
  g.fillStyle = sky;
  g.fillRect(0, 0, width, height);

  // Wall on the left, door on the right — something asymmetric, so a crop shows.
  g.fillStyle = '#4a4036';
  g.fillRect(0, height * 0.18, width * 0.34, height * 0.72);
  g.fillStyle = '#5d5142';
  g.fillRect(width * 0.62, height * 0.2, width * 0.3, height * 0.66);
  g.fillStyle = '#2b2620';
  g.fillRect(width * 0.68, height * 0.28, width * 0.18, height * 0.55);

  // Path receding to the middle — the thing a doorbell actually watches.
  g.fillStyle = '#6b6f76';
  g.beginPath();
  g.moveTo(width * 0.3, height);
  g.lineTo(width * 0.45, height * 0.56);
  g.lineTo(width * 0.58, height * 0.56);
  g.lineTo(width * 0.78, height);
  g.closePath();
  g.fill();

  // Porch light pool.
  const pool = g.createRadialGradient(width * 0.72, height * 0.3, 2, width * 0.72, height * 0.3, height * 0.6);
  pool.addColorStop(0, 'rgba(255,224,160,0.55)');
  pool.addColorStop(1, 'rgba(255,224,160,0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, width, height);

  // Wheelie bins, because every doorbell view has them.
  g.fillStyle = '#2f3a33';
  g.fillRect(width * 0.36, height * 0.45, width * 0.08, height * 0.2);
  g.fillRect(width * 0.46, height * 0.46, width * 0.07, height * 0.18);

  // Lens vignette: the wide-angle falloff that makes the crop obvious.
  const vignette = g.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.25,
    width / 2, height / 2, Math.max(width, height) * 0.62,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.72)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

setCameraSnapshotAccount('span-mock');
const generation = cameraSnapshotCacheGeneration();

const landscape = {
  id: 'cam-landscape', homeId: 'span-home', name: 'Front Door',
  isReachable: true, services: [], camera: { snapshot: true, stream: true },
};
const portrait = { ...landscape, id: 'cam-portrait' };

setCameraSnapshot(cameraSnapshotCacheKey(landscape.homeId, landscape.id), {
  dataUrl: drawPorch(1280, 720), width: 1280, height: 720,
  capturedAt: new Date(Date.now() - 5 * 60_000).toISOString(), source: 'snapshot',
}, generation);
setCameraSnapshot(cameraSnapshotCacheKey(portrait.homeId, portrait.id), {
  dataUrl: drawPorch(960, 1280), width: 960, height: 1280,
  capturedAt: new Date(Date.now() - 5 * 60_000).toISOString(), source: 'snapshot',
}, generation);

const Toggle = ({ on = false }: { on?: boolean }) => (
  <span style={{
    width: 36, height: 20, borderRadius: 20, display: 'inline-block',
    background: on ? '#eab308' : 'rgba(120,130,150,0.55)',
  }} />
);

function Neighbours() {
  return (
    <>
      <div style={{ gridColumn: 'span 1' }}>
        <WidgetCard title="Aqara Smart Lock" subtitle="Locked" icon={<Lock />} compact isReachable
          serviceType="lock_mechanism" headerAction={<Toggle />} />
      </div>
      <div style={{ gridColumn: 'span 1' }}>
        <WidgetCard title="Alarm" subtitle="Disarmed" icon={<ShieldCheck />} compact isReachable
          serviceType="security_system" headerAction={<Toggle />} />
      </div>
    </>
  );
}

/**
 * The tile root ships `h-fit`, and the preview is `absolute inset-0` inside the
 * card HEADER — so a spanning tile would not grow the picture on its own.
 * Rather than force it with CSS, this grows the header by exactly the extra grid
 * area, which is what the real change would have to arrange for. `extraHeight`
 * is (rows - 1) * (rowHeight + gap), so the card lands on the grid lines.
 */
function Camera({ which, extraHeight = 0 }: { which: 'landscape' | 'portrait'; extraHeight?: number }) {
  const accessory = which === 'landscape' ? landscape : portrait;
  return (
    <WidgetCard
      title="Front Door"
      subtitle="Doorbell camera · 90%"
      icon={<Video />}
      compact
      isReachable
      collapsedPreview={<>
        <CameraTilePreview accessory={accessory as never} paused />
        {extraHeight > 0 && <div aria-hidden style={{ width: 0, height: extraHeight, flex: '0 0 0px' }} />}
      </>}
    />
  );
}

/** One phone-width column: a label, then the Front Door room grid. */
function Panel({
  label, note, children, rowHeight,
}: { label: string; note: string; children: React.ReactNode; rowHeight: number }) {
  return (
    <section style={{ width: 380 }}>
      <h2 style={{ color: '#f8fafc', font: '600 15px/1.3 system-ui', margin: '0 0 2px' }}>{label}</h2>
      <p style={{ color: '#94a3b8', font: '400 12px/1.45 system-ui', margin: '0 0 12px', minHeight: 34 }}>{note}</p>
      <p style={{ color: '#cbd5e1', font: '600 13px/1 system-ui', margin: '0 0 8px' }}>Front Door</p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
        gridAutoRows: `${rowHeight}px`, alignItems: 'start',
      }}>
        {children}
      </div>
    </section>
  );
}

function Mock() {
  const probe = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(0);
  // The row height a spanning grid needs is whatever a normal compact tile
  // measures today — not a number chosen here. Measure one and use it.
  useLayoutEffect(() => {
    if (probe.current) setRowHeight(Math.round(probe.current.getBoundingClientRect().height));
  }, []);

  return (
    <main style={{ padding: 24, background: '#0b1220', minHeight: '100vh', font: '14px system-ui' }}>
      <div ref={probe} style={{ position: 'absolute', visibility: 'hidden', width: 186 }}>
        <WidgetCard title="Probe" subtitle="Off" icon={<Lightbulb />} compact isReachable headerAction={<Toggle />} />
      </div>
      {rowHeight > 0 && (
        <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
          <Panel rowHeight={rowHeight} label="Today — Regular (1×1)"
            note="What ships now. One cell, and the wide snapshot is cropped hard to fit it.">
            <Neighbours />
            <div data-mock-tile="regular" style={{ gridColumn: 'span 1' }}><Camera which="landscape" /></div>
          </Panel>

          <Panel rowHeight={rowHeight} label="Proposed — Large (2×2)"
            note="Two columns by two rows. On a phone that is the full width, so the 16:9 snapshot is shown nearly uncropped.">
            <Neighbours />
            <div data-mock-tile="large" style={{ gridColumn: 'span 2', gridRow: 'span 2' }}>
              <Camera which="landscape" extraHeight={rowHeight + 8} />
            </div>
          </Panel>

          <Panel rowHeight={rowHeight} label="Proposed — Tall (1×2)"
            note="One column by two rows, offered only when the camera reports a portrait snapshot (here 960×1280). A landscape camera would not be offered this."
          >
            <Neighbours />
            <div data-mock-tile="tall" style={{ gridColumn: 'span 1', gridRow: 'span 2' }}>
              <Camera which="portrait" extraHeight={rowHeight + 8} />
            </div>
            <div style={{ gridColumn: 'span 1' }}>
              <WidgetCard title="Lights" subtitle="On" icon={<Lightbulb />} compact isReachable isOn
                serviceType="lightbulb" headerAction={<Toggle on />} />
            </div>
          </Panel>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Mock />);
