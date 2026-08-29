/**
 * The iPhone dashboard, replicated from the screenshot at 390×844 and scaled
 * to fit — the same home as the desktop, so a tap here shows up there. The
 * capture is cropped just under the status bar; here the bar and island are
 * drawn, so the content sits where it does on a phone.
 */
import { Menu, Search, MoreVertical, Signal, Wifi, BatteryFull, Thermometer, Activity, Lock, ChevronRight, Lightbulb, Fan, Blinds, Power, Video, Droplets, Plug, Percent } from 'lucide-react';
import { ScaledFrame, Wallpaper, Toggle } from './scaled';
import { cx } from './util';
import type { Home } from './home-state';

const TONE = {
  yellow: 'bg-yellow-200/85 text-zinc-900',
  cyan: 'bg-cyan-200/85 text-zinc-900',
  violet: 'bg-violet-200/85 text-zinc-900',
  dark: 'bg-zinc-900/45 text-white',
} as const;

const circle = 'flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900/75 text-white';
const pill = 'inline-flex h-[26px] items-center gap-1.5 rounded-full bg-black/45 px-3 text-[11px] font-medium text-white';
const label = 'mb-2 mt-4 text-[12px] font-medium text-white/85 drop-shadow';

function Tile({ tone, icon: Icon, iconClass, name, sub, right, onClick }: {
  tone: keyof typeof TONE; icon: typeof Lightbulb; iconClass: string; name: string; sub: string; right?: React.ReactNode; onClick?: () => void;
}) {
  const dark = tone === 'dark';
  const body = (
    <>
      <div className="flex items-start justify-between">
        <span className={cx('flex h-[30px] w-[30px] items-center justify-center rounded-full', iconClass)}><Icon className="h-3.5 w-3.5" /></span>
        {right}
      </div>
      <div className="mt-auto">
        <div className="truncate text-[12.5px] font-semibold leading-tight">{name}</div>
        <div className={cx('text-[10.5px] leading-tight', dark ? 'text-zinc-300' : 'text-zinc-600')}>{sub}</div>
      </div>
    </>
  );
  const cls = cx('relative flex h-[92px] flex-col rounded-[16px] p-3 text-left', TONE[tone]);
  return onClick ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>;
}

export function MobileDashboardDemo({ home, className }: { home: Home; className?: string }) {
  const { s, patch } = home;
  return (
    <ScaledFrame width={390} height={740} className={cx('rounded-2xl border border-border/50 shadow-lg', className)}>
      <Wallpaper />
      {/* Status bar and island — the capture is cropped below them, but on a phone they're there. */}
      <div className="absolute inset-x-0 top-0 flex h-[50px] items-center justify-between px-7 text-[13px] font-semibold text-white">
        <span>9:41</span>
        <span className="absolute left-1/2 top-[11px] h-[30px] w-[108px] -translate-x-1/2 rounded-full bg-black" />
        <span className="flex items-center gap-1.5"><Signal className="h-3.5 w-3.5" /><Wifi className="h-3.5 w-3.5" /><BatteryFull className="h-4 w-4" /></span>
      </div>
      <div className="absolute inset-0 px-4 pt-[62px]">
        <div className="flex items-center justify-between">
          <span className={circle}><Menu className="h-4 w-4" /></span>
          <span className="flex gap-2"><span className={circle}><Search className="h-4 w-4" /></span><span className={circle}><MoreVertical className="h-4 w-4" /></span></span>
        </div>
        <div className="mt-[22px] text-[17px] font-bold text-white drop-shadow">My Home</div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className={pill}><Thermometer className="h-3.5 w-3.5" /> 20.5°C – 22.3°C</span>
          <span className={cx(pill, s.motion && 'text-emerald-300')}><Activity className="h-3.5 w-3.5" /> {s.motion ? 'Motion' : 'No motion'}</span>
          <span className={cx(pill, s.locked ? 'text-emerald-300' : 'text-amber-300')}><Lock className="h-3.5 w-3.5" /> {s.locked ? 'Locked' : 'Unlocked'}</span>
        </div>
        <div className="mt-3 flex items-center gap-1 text-[12px] font-medium text-white/85 drop-shadow">Automations <ChevronRight className="h-3.5 w-3.5" /></div>

        <div className={label}>Bedroom</div>
        <div className="grid grid-cols-2 gap-[7px]">
          <Tile tone="yellow" icon={Lightbulb} iconClass="bg-yellow-400 text-yellow-900" name="All Lights" sub="4 devices"
            right={<Toggle on={s.lights.on} onChange={(on) => patch({ lights: { ...s.lights, on } })} color="bg-yellow-500" w={30} h={16} />} />
          <Tile tone="cyan" icon={Fan} iconClass="bg-cyan-500 text-white" name="Ceiling Fan" sub={s.fan.on ? `${s.fan.speed}% speed` : 'Off'}
            right={<Toggle on={s.fan.on} onChange={(on) => patch({ fan: { ...s.fan, on } })} color="bg-cyan-500" w={30} h={16} />} />
          <Tile tone="violet" icon={Blinds} iconClass="bg-violet-500 text-white" name="Blinds" sub={s.blinds === 0 ? 'Closed' : `${s.blinds}% Open`}
            right={<button type="button" onClick={() => patch({ blinds: s.blinds > 0 ? 0 : 100 })} className="rounded-full bg-violet-500 px-2.5 py-0.5 text-[10px] font-medium text-white">{s.blinds > 0 ? 'Close' : 'Open'}</button>} />
        </div>

        <div className={label}>Front Door</div>
        <div className="grid grid-cols-2 gap-[7px]">
          <Tile tone="dark" icon={Power} iconClass="bg-blue-200/30 text-blue-300" name="Lock" sub={s.locked ? 'Locked' : 'Unlocked'} onClick={() => patch({ locked: !s.locked })}
            right={<span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white"><Percent className="h-2.5 w-2.5" /></span>} />
          <Tile tone="dark" icon={Video} iconClass="bg-white/25 text-white" name="Doorbell Camera" sub="Off" />
          <Tile tone="dark" icon={Activity} iconClass={s.motion ? 'bg-emerald-400 text-white' : 'bg-emerald-200/30 text-emerald-300'} name="Motion Sensor" sub={s.motion ? 'Motion detected' : 'No motion'} onClick={() => patch({ motion: !s.motion })} />
        </div>

        <div className={label}>Garden</div>
        <div className="grid grid-cols-2 gap-[7px]">
          <Tile tone="yellow" icon={Lightbulb} iconClass="bg-yellow-400 text-yellow-900" name="All Lights" sub="4 devices"
            right={<Toggle on={s.gardenLights} onChange={(gardenLights) => patch({ gardenLights })} color="bg-yellow-500" w={30} h={16} />} />
          <Tile tone="dark" icon={Droplets} iconClass="bg-blue-200/30 text-blue-300" name="Irrigation" sub={s.irrigation ? 'Running' : 'Off'}
            right={<Toggle on={s.irrigation} onChange={(irrigation) => patch({ irrigation })} color="bg-blue-500" dark w={30} h={16} />} />
        </div>

        <div className={label}>Kitchen</div>
        <div className="grid grid-cols-2 gap-[7px]">
          <Tile tone="yellow" icon={Lightbulb} iconClass="bg-yellow-400 text-yellow-900" name="All Lights" sub="4 devices"
            right={<Toggle on={s.kitchenLights} onChange={(kitchenLights) => patch({ kitchenLights })} color="bg-yellow-500" w={30} h={16} />} />
          <Tile tone="dark" icon={Plug} iconClass="bg-blue-200/30 text-blue-300" name="Coffee Maker" sub={s.coffee ? 'On' : 'Off'}
            right={<Toggle on={s.coffee} onChange={(coffee) => patch({ coffee })} color="bg-blue-500" dark w={30} h={16} />} />
          <Tile tone="dark" icon={Thermometer} iconClass="bg-red-200/30 text-red-300" name="Sensor" sub="Temperature · 22.3°C" />
        </div>
      </div>
    </ScaledFrame>
  );
}
