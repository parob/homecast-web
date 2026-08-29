/** The flow editor: a motion-light automation you can run and watch execute. */
import { useEffect, useRef, useState } from 'react';
import { Home, Undo2, Redo2, Save, Zap, Lightbulb, Timer, Play } from 'lucide-react';
import { cx } from './util';

const DELAYS = ['1m', '5m', '10m'];

export function AutomationDemo() {
  const [step, setStep] = useState(-1);
  const [lightOn, setLightOn] = useState(false);
  const [delay, setDelay] = useState(1);
  const timers = useRef<number[]>([]);
  const running = step >= 0;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const run = () => {
    if (running) return;
    setStep(0);
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    at(600, () => { setStep(1); setLightOn(true); });
    at(1300, () => setStep(2));
    at(2900, () => { setStep(3); setLightOn(false); });
    at(3600, () => setStep(-1));
  };

  const nodes = [
    { icon: Zap, color: 'bg-emerald-500', title: 'Device Changed', sub: 'Motion Sensor / Motion Detected → Yes', onClick: run },
    { icon: Lightbulb, color: 'bg-primary', title: 'Set Device', sub: 'Set Ceiling Light to On' },
    { icon: Timer, color: 'bg-primary', title: 'Delay', sub: `Wait ${DELAYS[delay]}`, onClick: () => !running && setDelay((d) => (d + 1) % DELAYS.length) },
    { icon: Lightbulb, color: 'bg-primary', title: 'Set Device', sub: 'Set Ceiling Light to Off' },
  ];

  return (
    <div className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><Home className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1 truncate rounded-md border border-border px-2.5 py-1 text-sm">Motion Light – Living Room</span>
        <Undo2 className="h-4 w-4 text-muted-foreground" /><Redo2 className="h-4 w-4 text-muted-foreground" />
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/60 px-2.5 py-1 text-xs font-medium text-primary-foreground"><Save className="h-3 w-3" /> Save</span>
      </div>

      <div className="relative bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] p-5 [background-size:14px_14px]">
        <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium shadow-sm">
          <Lightbulb className={cx('h-3.5 w-3.5 transition-colors', lightOn ? 'text-amber-500' : 'text-muted-foreground')} />
          Ceiling Light · {lightOn ? 'On' : 'Off'}
        </div>

        <div className="mx-auto mt-6 flex max-w-[280px] flex-col items-center">
          {nodes.map((n, i) => {
            const active = step === i;
            const done = step > i;
            return (
              <div key={i} className="flex w-full flex-col items-center">
                {i > 0 && <div className={cx('h-5 w-px transition-colors', done || active ? 'bg-primary' : 'bg-border')} />}
                <button type="button" onClick={n.onClick} disabled={!n.onClick}
                  className={cx('relative flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-all',
                    active ? 'border-primary ring-2 ring-primary/30' : done ? 'border-primary/40' : 'border-border',
                    n.onClick && !running && 'hover:border-primary/60', !n.onClick && 'cursor-default')}>
                  <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white', n.color)}><n.icon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{n.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{n.sub}</span>
                  </span>
                  {i === 0 && !running && <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"><Play className="h-3 w-3" /> Trigger</span>}
                  {i === 2 && (
                    <span className="absolute inset-x-3 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full bg-primary" style={{ width: active ? '100%' : '0%', transition: active ? 'width 1.5s linear' : 'none' }} />
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">Tap the trigger to run it; tap Delay to change the wait.</p>
      </div>
    </div>
  );
}
