import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CameraSnapshotHero } from '../../src/components/widgets/CameraWidget';
import { serverConnection } from '../../src/server/connection';
import { setCameraSnapshotAccount } from '../../src/lib/camera-snapshot-cache';
import type { CameraLiveEvent } from '../../src/lib/camera-live';
import '../../src/index.css';

// Entirely synthetic transport/pixels. The production hook and viewer render
// unchanged; no account, physical camera, or private photograph is involved.
setCameraSnapshotAccount('camera-live-browser-test');
const canvas = document.createElement('canvas');
canvas.width = 540; canvas.height = 960;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#497d88'; ctx.fillRect(0, 0, 540, 960);
ctx.fillStyle = '#e8ad5c'; ctx.fillRect(20, 20, 500, 40); ctx.fillRect(20, 900, 500, 40);
const jpeg = canvas.toDataURL('image/jpeg').split(',')[1];
const listeners = new Set<(event: CameraLiveEvent) => void>();
const viewers = new Map<string, { accessory: string; state: 'queued' | 'streaming' }>();
let seq = 0;
const emit = (event: CameraLiveEvent) => listeners.forEach(listener => listener(event));
const status = (id: string) => ({ watchId: id, streamId: viewers.get(id)?.accessory, state: viewers.get(id)?.state ?? 'stopped', queuePosition: 1 });
const frame = (watchId: string) => {
  const viewer = viewers.get(watchId);
  if (viewer?.state === 'streaming') emit({ type: 'camera_frame', watchId, streamId: viewer.accessory, accessoryId: viewer.accessory,
    homeId: 'home', seq: ++seq, jpeg, width: 540, height: 960, capturedAt: new Date().toISOString() });
};
serverConnection.getState = () => ({ connectionState: 'connected' }) as ReturnType<typeof serverConnection.getState>;
serverConnection.subscribe = () => () => {};
serverConnection.subscribeToBroadcasts = listener => { listeners.add(listener); return () => listeners.delete(listener); };
serverConnection.request = (async (action: string, payload: Record<string, unknown>) => {
  const id = payload.watchId as string;
  if (action === 'camera.live.start') {
    const distinct = new Set([...viewers.values()].filter(v => v.state === 'streaming').map(v => v.accessory));
    const accessory = payload.accessoryId as string;
    viewers.set(id, { accessory, state: distinct.has(accessory) || distinct.size < 2 ? 'streaming' : 'queued' });
    setTimeout(() => frame(id), 25);
  } else if (action === 'camera.live.stop') {
    viewers.delete(id);
    const distinct = new Set([...viewers.values()].filter(v => v.state === 'streaming').map(v => v.accessory));
    for (const [watchId, viewer] of viewers) {
      if (viewer.state === 'queued' && distinct.size < 2) {
        viewer.state = 'streaming'; distinct.add(viewer.accessory);
        emit({ type: 'camera_live_state', ...status(watchId) });
        setTimeout(() => frame(watchId), 25);
      }
    }
  } else if (action === 'camera.snapshot') {
    return { jpeg, capturedAt: new Date().toISOString(), width: 540, height: 960, source: 'stream', mimeType: 'image/jpeg' };
  }
  return status(id);
}) as typeof serverConnection.request;
setInterval(() => viewers.forEach((_, id) => frame(id)), 250);

function Fixture() {
  const [opened, setOpened] = useState([true, true, true]);
  return <main className="grid gap-4 p-4 lg:grid-cols-3">
    {opened.map((open, i) => <section key={i} data-camera={i} className="min-w-0">
      <h2>Camera {i + 1}</h2>
      <button onClick={() => setOpened(items => items.map((value, n) => n === i ? !value : value))}>{open ? 'Close' : 'Open'} viewer {i + 1}</button>
      {open && <CameraSnapshotHero accessory={{ id: `camera-${i}`, homeId: 'home', name: `Camera ${i + 1}`, services: [], isReachable: true, camera: { snapshot: true, stream: true } }} expanded />}
    </section>)}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
