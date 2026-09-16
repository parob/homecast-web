import React from 'react';
import { createRoot } from 'react-dom/client';
import { Video, Lightbulb, Battery } from 'lucide-react';
import { WidgetCard } from '../../src/components/widgets/WidgetCard';
import { CameraTilePreview } from '../../src/components/widgets/CameraTilePreview';
import { cameraSnapshotCacheGeneration, cameraSnapshotCacheKey, setCameraSnapshot, setCameraSnapshotAccount } from '../../src/lib/camera-snapshot-cache';
import '../../src/index.css';

setCameraSnapshotAccount('camera-layout-test');
const camera = { id: 'layout-camera', homeId: 'layout-home', name: 'Camera', isReachable: true, services: [], camera: { snapshot: true, stream: true } };
setCameraSnapshot(cameraSnapshotCacheKey(camera.homeId, camera.id), {
  // Synthetic bytes: no private camera photograph in the fixture.
  dataUrl: 'data:image/jpeg;base64,QUJD', width: 1280, height: 720,
  capturedAt: '2026-09-16T08:00:00Z', source: 'stream',
}, cameraSnapshotCacheGeneration());
const compact = new URLSearchParams(location.search).get('compact') !== '0';
const toggle = <button aria-label="Camera enabled" style={{ width: 36, height: 20, borderRadius: 20, background: '#64748b' }} />;
createRoot(document.getElementById('root')!).render(<main style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16 }}>
  <div data-layout-tile="light" style={{ width: 'var(--tile-width, 180px)' }}>
    <WidgetCard title="Lights" subtitle="Off" icon={<Lightbulb />} compact={compact} isReachable />
  </div>
  <div data-layout-tile="camera" style={{ width: 'var(--tile-width, 180px)' }}>
    <WidgetCard title="Camera" subtitle="On" icon={<Video />} headerAction={toggle} compact={compact} isReachable
      collapsedPreview={<CameraTilePreview accessory={camera} paused />} />
  </div>
  <div data-layout-tile="doorbell" style={{ width: 'var(--tile-width, 180px)' }}>
    <WidgetCard title="Front Door" subtitle={<span className="flex min-w-0 items-center gap-x-2 overflow-hidden">
      <span className="min-w-0 truncate">Doorbell camera</span><span className="flex shrink-0 items-center gap-0.5"><Battery className="h-3 w-3" />96%</span>
    </span>} icon={<Video />} compact={compact} isReachable
      collapsedPreview={<CameraTilePreview accessory={camera} paused />} />
  </div>
</main>);
