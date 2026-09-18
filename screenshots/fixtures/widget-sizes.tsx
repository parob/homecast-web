import React from 'react';
import { createRoot } from 'react-dom/client';
import { Video, Lightbulb, Lock, Thermometer } from 'lucide-react';
import { WidgetCard } from '../../src/components/widgets/WidgetCard';
import { CameraTilePreview } from '../../src/components/widgets/CameraTilePreview';
import {
  cameraSnapshotCacheGeneration,
  cameraSnapshotCacheKey,
  setCameraSnapshot,
  setCameraSnapshotAccount,
} from '../../src/lib/camera-snapshot-cache';
import { gridRowUnitStyle, widgetSizeStyle, type WidgetSize } from '../../src/lib/widget-sizes';
import { useGridRowUnit } from '../../src/hooks/useGridRowUnit';
import '../../src/index.css';

/**
 * A real two-column phone grid, with the real WidgetCard and the real camera
 * preview, so a size change can be measured and photographed rather than
 * argued about.
 *
 * `?size=` sets what the camera is; everything else stays Regular. That is the
 * before/after: one grid, one setting, nothing else different.
 */

// Synthetic picture, drawn here rather than shipped: no real camera photograph
// belongs in a fixture. JPEG because the snapshot cache validates the prefix.
function syntheticJpeg(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#2d4a6b');
  sky.addColorStop(0.55, '#7d8fa3');
  sky.addColorStop(1, '#3c3128');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  // A doorway and a path, so cropping is visible rather than a flat wash.
  ctx.fillStyle = '#23303f';
  ctx.fillRect(width * 0.12, height * 0.18, width * 0.3, height * 0.66);
  ctx.fillStyle = '#c8a06a';
  ctx.fillRect(width * 0.17, height * 0.3, width * 0.2, height * 0.5);
  ctx.fillStyle = '#5d6b58';
  ctx.beginPath();
  ctx.moveTo(width, height);
  ctx.lineTo(width * 0.45, height);
  ctx.lineTo(width * 0.78, height * 0.42);
  ctx.lineTo(width, height * 0.42);
  ctx.closePath();
  ctx.fill();
  // Corner marks make any crop obvious at a glance in a screenshot.
  ctx.fillStyle = '#ff5f5f';
  const mark = Math.min(width, height) * 0.06;
  ctx.fillRect(0, 0, mark, mark);
  ctx.fillRect(width - mark, 0, mark, mark);
  ctx.fillRect(0, height - mark, mark, mark);
  ctx.fillRect(width - mark, height - mark, mark, mark);
  return canvas.toDataURL('image/jpeg', 0.85);
}

setCameraSnapshotAccount('widget-sizes-test');

const params = new URLSearchParams(location.search);
const size = (params.get('size') ?? 'regular') as WidgetSize;
const portrait = params.get('portrait') === '1';

const camera = {
  id: 'front-door',
  homeId: 'size-home',
  name: 'Front Door',
  isReachable: true,
  services: [],
  camera: { snapshot: true, stream: true },
};

const [w, h] = portrait ? [960, 1280] : [1920, 1080];
setCameraSnapshot(
  cameraSnapshotCacheKey(camera.homeId, camera.id),
  { dataUrl: syntheticJpeg(w, h), width: w, height: h, capturedAt: new Date().toISOString(), source: 'stream' },
  cameraSnapshotCacheGeneration(),
);

const toggle = (label: string) => (
  <button aria-label={label} style={{ width: 36, height: 20, borderRadius: 20, background: '#64748b' }} />
);

// The dashboard's own compact phone grid: two columns, items-start, gap-2 —
// including the measured row track, which is half of what gives a sized tile
// its height. Measuring it here rather than hard-coding one keeps the fixture
// honest: if the hook stops working, the spec's height assertions fail.
function Grid() {
  const [gridRef, rowUnit] = useGridRowUnit(size !== 'regular');
  return (
    <div
      ref={gridRef}
      className="grid items-start gap-2 grid-cols-2"
      data-size-grid
      data-row-unit={rowUnit ?? ''}
      style={gridRowUnitStyle(size !== 'regular', rowUnit)}
    >
      <div data-tile="camera" style={widgetSizeStyle(size)}>
        <WidgetCard
          title="Front Door"
          subtitle="Camera"
          icon={<Video />}
          compact
          isReachable
          size={size}
          sizeOptions={['regular', 'large', 'tall']}
          onSizeChange={() => {}}
          collapsedPreview={<CameraTilePreview accessory={camera} paused />}
        />
      </div>
      <div data-tile="lights">
        <WidgetCard title="Lights" subtitle="Off" icon={<Lightbulb />} compact isReachable headerAction={toggle('Lights')} />
      </div>
      <div data-tile="lock">
        <WidgetCard title="Front Lock" subtitle="Locked" icon={<Lock />} compact isReachable headerAction={toggle('Lock')} />
      </div>
      <div data-tile="thermostat">
        <WidgetCard title="Hallway" subtitle="19°C" icon={<Thermometer />} compact isReachable headerAction={toggle('Heating')} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 16, width: 390 }}>
    <Grid />
  </main>,
);
