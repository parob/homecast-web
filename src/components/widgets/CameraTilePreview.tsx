import React, { useEffect, useRef, useState } from 'react';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import { describeCaptureAge } from '@/lib/camera-snapshot';
import { useCameraSnapshot } from '@/hooks/useCameraSnapshot';

/** Full bleed is a still, never a claim that the camera is streaming live. */
export function CameraTilePreview({ accessory, paused = false }: { accessory: HomeKitAccessory; paused?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { status } = useCameraSnapshot(accessory, visible && !paused, true);
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [visible]);
  const picture = status.kind === 'ready' || status.kind === 'error' ? status : undefined;
  const portrait = !!picture?.width && !!picture?.height && picture.height > picture.width;
  const age = picture?.capturedAt ? describeCaptureAge(picture.capturedAt, now) : undefined;
  const caption = age
    ? `${status.kind === 'error' ? 'Last image' : 'Snapshot'} ${picture?.source === 'stream' ? 'captured' : 'requested'} ${age}`
    : status.kind === 'error' ? 'Preview unavailable' : 'Waiting for image';
  return <><div ref={ref} data-camera-tile-preview className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl bg-slate-950">
    {picture?.dataUrl && <img src={picture.dataUrl} alt="" draggable={false}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ objectPosition: portrait ? 'center 23%' : 'center 42%' }} />}
    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #04101e3b, transparent 38%, #04101e4a 58%, #04101ef0)' }} />
  </div>
    {/* In the header row, not absolutely positioned over title/status. The
        normal icon determines row height, so preview tiles match neighbours. */}
    <div data-camera-tile-caption className="pointer-events-none relative z-10 min-w-0 max-w-full flex-1 self-center truncate px-1 text-right text-[10px] leading-none text-white/80"
      aria-label={caption} title={`${caption}${picture?.capturedAt ? ` · ${picture.capturedAt}` : ''}`}>
      {age ? <time dateTime={picture?.capturedAt}>{age}</time> : status.kind === 'error' ? 'Unavailable' : 'Waiting'}
    </div>
  </>;
}
