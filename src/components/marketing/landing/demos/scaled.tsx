/**
 * Pieces for replicating a screenshot at its own proportions: a frame that
 * lays content out at a fixed logical size and scales it to fit, the blurred
 * wallpaper (a 640px copy of the app's beach preset, blurred in the file — a runtime blur under two dozen backdrop filters stalled Chrome's compositor), and the toggle and bar controls the dashboard tiles use.
 * Controls compute from bounding rects, so they work inside the transform.
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { cx } from './util';

export function ScaledFrame({ width, height, className, children }: { width: number; height: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  // The outer box keeps the capture's aspect ratio in CSS, so only its width
  // feeds the scale — no height write-back, nothing for the observer to chase.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.round((el.clientWidth / width) * 1000) / 1000);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className={cx('relative w-full overflow-hidden', className)} style={{ aspectRatio: `${width} / ${height}` }}>
      <div className="absolute left-0 top-0" style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', visibility: scale ? 'visible' : 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

export function Wallpaper() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <img src="/images/features/beach-blur.jpg" alt="" className="h-full w-full object-cover" />
      <div className="absolute inset-0 bg-black/10" />
    </div>
  );
}

export function Toggle({ on, onChange, color, dark, w = 28, h = 15 }: { on: boolean; onChange: (v: boolean) => void; color: string; dark?: boolean; w?: number; h?: number }) {
  const knob = h - 4;
  return (
    <button type="button" role="switch" aria-checked={on} onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={cx('relative shrink-0 rounded-full transition-colors', on ? color : dark ? 'bg-white/25' : 'bg-black/15')} style={{ width: w, height: h }}>
      <span className="absolute top-[2px] rounded-full bg-white shadow-sm transition-[left] duration-200" style={{ width: knob, height: knob, left: on ? w - knob - 2 : 2 }} />
    </button>
  );
}

export function Bar({ value, onChange, fill, track, gradient, height = 10 }: { value: number; onChange: (v: number) => void; fill?: string; track: string; gradient?: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const setFrom = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    onChange(Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))));
  };
  return (
    <div ref={ref} role="slider" aria-valuenow={value} tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setFrom(e); }}
      onPointerMove={(e) => { if (e.buttons) setFrom(e); }}
      className={cx('relative w-full cursor-pointer overflow-hidden rounded-full', track)} style={{ height }}>
      <div className={cx('absolute inset-y-0 left-0 rounded-full', fill)} style={{ width: `${value}%`, background: gradient }} />
    </div>
  );
}
