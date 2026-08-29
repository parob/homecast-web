/**
 * The desktop dashboard, replicated from the screenshot at 1000×625 and
 * scaled to fit: floating sidebar, summary pills, the Home Mode tile, the
 * Bedroom and Front Door rooms. Everything you could press in the capture
 * can be pressed here, and the pills follow.
 */
import type { ReactNode } from 'react';
import { Search, MoreVertical, Home as HomeIcon, Users, Folder, Plus, ListChecks, Zap, Workflow, Thermometer, Activity, Lock, ChevronRight, ChevronUp, ChevronDown, Minus, Lightbulb, Power, Fan, Blinds, Hash, Video } from 'lucide-react';
import { HomecastMark } from '@/components/HomecastMark';
import { ScaledFrame, Wallpaper, Toggle, Bar } from './scaled';
import { cx } from './util';
import type { Home, HomeMode } from './home-state';

const TONE = {
  yellow: 'bg-yellow-200/85 text-zinc-900',
  blue: 'bg-blue-200/85 text-zinc-900',
  cyan: 'bg-cyan-200/85 text-zinc-900',
  violet: 'bg-violet-200/85 text-zinc-900',
  grey: 'bg-zinc-200/90 text-zinc-900',
  dark: 'bg-zinc-900/45 text-white',
} as const;

const pill = 'inline-flex h-[20px] items-center gap-1 rounded-full bg-black/45 px-2.5 text-[9.5px] font-medium text-white';
const modeBtn = 'h-[22px] rounded-full text-[9.5px] font-medium transition-colors';
const label = 'text-[10.5px] font-medium text-white/85 drop-shadow';

function Head({ icon: Icon, iconClass, title, sub, right, dark }: { icon: typeof Lightbulb; iconClass: string; title: string; sub: ReactNode; right?: ReactNode; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', iconClass)}><Icon className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold leading-tight">{title}</span>
        <span className={cx('block text-[9px] leading-tight', dark ? 'text-zinc-300' : 'text-zinc-600')}>{sub}</span>
      </span>
      {right}
    </div>
  );
}

export function DashboardDemo({ home, className }: { home: Home; className?: string }) {
  const { s, patch } = home;
  const modes: HomeMode[] = ['Home', 'Away', 'Night', 'Vacation'];

  return (
    <ScaledFrame width={1000} height={625} className={cx('rounded-xl border border-border/50 shadow-lg', className)}>
      <Wallpaper />

      {/* Sidebar */}
      <aside className="absolute left-4 top-4 w-[142px] rounded-[18px] bg-zinc-900/40 p-2 text-white">
        <div className="flex items-center gap-2 p-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary"><HomecastMark className="h-3.5 w-3.5 text-white" /></span>
          <span className="text-[13px] font-bold">Homecast</span>
        </div>
        <div className="mt-1 flex items-center justify-between rounded-xl px-2.5 py-1.5 text-[10.5px] font-medium"><span className="flex items-center gap-2"><HomeIcon className="h-3 w-3" /> Beach House</span><Users className="h-2.5 w-2.5 text-white/60" /></div>
        <div className="flex items-center gap-2 rounded-xl bg-primary px-2.5 py-1.5 text-[10.5px] font-medium"><HomeIcon className="h-3 w-3" /> My Home</div>
        <div className="mt-2 flex items-center justify-between px-2.5 text-[9px] text-white/60"><span>Collections</span><Plus className="h-2.5 w-2.5" /></div>
        {['All Lights', 'Bedtime'].map((c) => (
          <div key={c} className="flex items-center justify-between rounded-xl px-2.5 py-1.5 text-[10.5px] font-medium"><span className="flex items-center gap-2"><Folder className="h-3 w-3" /> {c}</span><span className="text-white/50">0</span></div>
        ))}
      </aside>

      {/* Top right */}
      <div className="absolute right-5 top-5 flex gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900/70 text-white"><Search className="h-3.5 w-3.5" /></span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900/70 text-white"><MoreVertical className="h-3.5 w-3.5" /></span>
      </div>

      {/* Main */}
      <div className="absolute inset-y-0 left-[178px] right-5 pt-[74px]">
        <div className="text-[14px] font-bold text-white drop-shadow">My Home</div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className={pill}><Zap className="h-2.5 w-2.5" /> Scenes <ChevronRight className="h-2.5 w-2.5" /></span>
          <span className={pill}><Workflow className="h-2.5 w-2.5" /> Automations 3 <ChevronRight className="h-2.5 w-2.5" /></span>
          <span className={pill}><Thermometer className="h-2.5 w-2.5" /> 20.5°C – 22.3°C</span>
          <span className={cx(pill, s.motion && 'text-emerald-300')}><Activity className="h-2.5 w-2.5" /> {s.motion ? 'Motion' : 'No motion'}</span>
          <span className={cx(pill, s.locked ? 'text-emerald-300' : 'text-amber-300')}><Lock className="h-2.5 w-2.5" /> {s.locked ? 'Locked' : 'Unlocked'}</span>
        </div>

        {/* Home Mode */}
        <div className={cx('mt-3 w-[195px] rounded-2xl p-3', TONE.dark)}>
          <Head icon={ListChecks} iconClass="bg-blue-100/90 text-blue-700" title="Home Mode" sub={s.mode} dark />
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            {modes.map((m) => (
              <button key={m} type="button" onClick={() => patch({ mode: m })} className={cx(modeBtn, s.mode === m ? 'bg-primary text-white ring-1 ring-white/50' : 'bg-white/10 text-white')}>{m}</button>
            ))}
          </div>
        </div>

        <div className={cx(label, 'mt-5')}>Bedroom</div>
        <div className="mt-2 grid grid-cols-4 items-start gap-[15px]">
          {/* All Lights */}
          <div className={cx('rounded-2xl p-3', TONE.yellow)}>
            <Head icon={Lightbulb} iconClass="bg-yellow-400 text-yellow-900" title="All Lights"
              sub={<>4 devices <span className="ml-1 rounded bg-black/10 px-1 text-[8px]">{s.lights.on ? '3/4 on' : '0/4 on'}</span></>}
              right={<Toggle on={s.lights.on} onChange={(on) => patch({ lights: { ...s.lights, on } })} color="bg-yellow-500" />} />
            <div className={cx('mt-2.5 transition-opacity', !s.lights.on && 'opacity-50')}>
              <div className="flex justify-between text-[9px]"><span className="text-zinc-600">All Lights</span><span className="font-medium">{s.lights.brightness}%</span></div>
              <div className="mt-1"><Bar value={s.lights.brightness} onChange={(v) => patch({ lights: { ...s.lights, brightness: v, on: v > 0 } })} fill="bg-yellow-500" track="bg-yellow-300/60" /></div>
              <div className="mt-2 flex justify-between text-[9px]"><span className="text-zinc-600">Color Temp</span><span className="font-medium">{Math.round(153 + (s.lights.temp / 100) * 347)}K</span></div>
              <div className="mt-1"><Bar value={s.lights.temp} onChange={(v) => patch({ lights: { ...s.lights, temp: v } })} track="bg-orange-200/70" gradient="linear-gradient(90deg,#67e8f9,#a8a29e 60%,#fdba74)" /></div>
            </div>
          </div>
          {/* Guest Staying */}
          <div className={cx('rounded-2xl p-3', TONE.blue)}>
            <Head icon={Power} iconClass="bg-white/70 text-blue-600" title="Guest Staying" sub={s.guest ? 'On' : 'Off'}
              right={<Toggle on={s.guest} onChange={(guest) => patch({ guest })} color="bg-blue-500" />} />
          </div>
          {/* Ceiling Fan */}
          <div className={cx('rounded-2xl p-3', TONE.cyan)}>
            <Head icon={Fan} iconClass="bg-cyan-500 text-white" title="Ceiling Fan" sub={s.fan.on ? `${s.fan.speed}% speed` : 'Off'}
              right={<Toggle on={s.fan.on} onChange={(on) => patch({ fan: { ...s.fan, on } })} color="bg-cyan-500" />} />
            <div className={cx('mt-2.5 transition-opacity', !s.fan.on && 'opacity-50')}>
              <div className="flex justify-between text-[9px]"><span className="text-zinc-600">Fan Speed</span><span className="font-medium">{s.fan.speed}%</span></div>
              <div className="mt-1"><Bar value={s.fan.speed} onChange={(v) => patch({ fan: { speed: v, on: v > 0 } })} fill="bg-cyan-500" track="bg-cyan-300/60" /></div>
            </div>
          </div>
          {/* Blinds */}
          <div className={cx('rounded-2xl p-3', TONE.violet)}>
            <Head icon={Blinds} iconClass="bg-violet-500 text-white" title="Blinds" sub={`${s.blinds}% Open`} />
            <div className="mt-2.5 flex items-center gap-1.5">
              <div className="relative h-[62px] flex-1 overflow-hidden rounded-xl bg-violet-200/90">
                <div className="absolute inset-x-0 top-0 bg-violet-500 transition-[height] duration-500" style={{ height: `${100 - s.blinds}%` }} />
                <div className="absolute inset-0 flex items-center justify-center text-[12.5px] font-bold text-zinc-900">{100 - s.blinds}% Closed</div>
              </div>
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => patch({ blinds: Math.min(100, s.blinds + 20) })} aria-label="Open" className="flex h-5 w-5 items-center justify-center rounded-full bg-white/70"><ChevronUp className="h-3 w-3" /></button>
                <button type="button" onClick={() => patch({ blinds: Math.max(0, s.blinds - 20) })} aria-label="Close" className="flex h-5 w-5 items-center justify-center rounded-full bg-white/70"><ChevronDown className="h-3 w-3" /></button>
              </div>
            </div>
          </div>
          {/* Door Opens Today */}
          <div className={cx('rounded-2xl p-3', TONE.dark)}>
            <Head icon={Hash} iconClass="bg-blue-100/90 text-blue-700" title="Door Opens Today" sub={String(s.doorOpens)} dark />
            <div className="mt-2.5 flex items-center gap-2">
              <button type="button" onClick={() => patch({ doorOpens: Math.max(0, s.doorOpens - 1) })} aria-label="Decrease" className="flex h-[22px] flex-1 items-center justify-center rounded-full bg-white/15"><Minus className="h-3 w-3" /></button>
              <span className="w-5 text-center text-[11px] font-medium">{s.doorOpens}</span>
              <button type="button" onClick={() => patch({ doorOpens: s.doorOpens + 1 })} aria-label="Increase" className="flex h-[22px] flex-1 items-center justify-center rounded-full bg-white/15"><Plus className="h-3 w-3" /></button>
            </div>
          </div>
        </div>

        <div className={cx(label, 'mt-4')}>Front Door</div>
        <div className="mt-2 grid grid-cols-4 items-start gap-[15px]">
          <div className={cx('rounded-2xl p-3', TONE.grey)}>
            <Head icon={Lock} iconClass="bg-white text-zinc-800" title="Lock" sub={s.locked ? 'Locked' : 'Unlocked'}
              right={<Toggle on={s.locked} onChange={(locked) => patch({ locked })} color="bg-zinc-800" />} />
          </div>
          <div className={cx('rounded-2xl p-3', TONE.dark)}>
            <Head icon={Video} iconClass="bg-white/25 text-white" title="Doorbell Camera" sub="Off" dark />
          </div>
          <button type="button" onClick={() => patch({ motion: !s.motion })} className={cx('rounded-2xl p-3 text-left', TONE.dark)}>
            <Head icon={Activity} iconClass={cx(s.motion ? 'bg-emerald-400 text-white' : 'bg-emerald-200/30 text-emerald-300')} title="Motion Sensor" sub={s.motion ? 'Motion detected' : 'No motion'} dark />
          </button>
        </div>
      </div>
    </ScaledFrame>
  );
}
