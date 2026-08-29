/** A Home Assistant phone dashboard with Homecast entities you can tap. */
import { useState } from 'react';
import { Menu, MoreVertical, Thermometer, Droplets, Car, Sofa, Lamp, LampCeiling, Lightbulb, Blinds, Speaker } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cx } from './util';

const HA_BLUE = '#03a9f4';

function Tile({ icon: Icon, name, state, on, onClick, className, children }: {
  icon: typeof Lamp; name: string; state: string; on: boolean; onClick?: () => void; className?: string; children?: React.ReactNode;
}) {
  return (
    <div className={cx('rounded-xl border border-black/5 bg-white p-2.5 shadow-sm dark:border-white/10 dark:bg-zinc-800', className)}>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 text-left">
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors', on ? 'bg-amber-100 text-amber-500 dark:bg-amber-900/50' : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400')}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium leading-tight">{name}</span>
          <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{state}</span>
        </span>
      </button>
      {children}
    </div>
  );
}

export function HomeAssistantDemo() {
  const [floor, setFloor] = useState(true);
  const [bar, setBar] = useState(true);
  const [spots, setSpots] = useState(49);
  const [blindsOpen, setBlindsOpen] = useState(true);
  const [playing, setPlaying] = useState(true);

  return (
    <div className="w-full max-w-[340px] rounded-[1.75rem] border border-border bg-zinc-100 p-1.5 shadow-lg dark:bg-zinc-950">
      <div className="overflow-hidden rounded-[1.4rem] bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
        <div className="flex items-center justify-between px-4 py-3 text-white" style={{ backgroundColor: HA_BLUE }}>
          <Menu className="h-5 w-5" />
          <span className="text-base font-medium">Home Assistant</span>
          <MoreVertical className="h-5 w-5" />
        </div>
        <div className="p-3">
          <div className="flex flex-wrap justify-center gap-1.5">
            {[[Thermometer, '10.5 °C', 'text-red-500'], [Droplets, '70.4%', 'text-blue-500'], [Car, 'Away', 'text-zinc-500']].map(([I, t, c]) => {
              const Icon = I as typeof Thermometer;
              return (
                <span key={t as string} className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs dark:border-white/10 dark:bg-zinc-800">
                  <Icon className={cx('h-3.5 w-3.5', c as string)} /> {t as string}
                </span>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between px-0.5">
            <span className="flex items-center gap-2 text-sm font-medium"><Sofa className="h-4 w-4" /> Living room</span>
            <span className="flex items-center gap-2 text-[11px] text-zinc-500"><span className="flex items-center gap-0.5"><Thermometer className="h-3 w-3 text-red-500" /> 22.8 °C</span><span className="flex items-center gap-0.5"><Droplets className="h-3 w-3 text-blue-500" /> 57%</span></span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Tile icon={Lamp} name="Floor lamp" state={floor ? '70%' : 'Off'} on={floor} onClick={() => setFloor((v) => !v)} />
              <Tile icon={Lightbulb} name="Bar lamp" state={bar ? 'On' : 'Off'} on={bar} onClick={() => setBar((v) => !v)} />
            </div>
            <Tile icon={LampCeiling} name="Spotlights" state={spots ? `${spots}%` : 'Off'} on={spots > 0} onClick={() => setSpots((v) => (v ? 0 : 49))}>
              <div className="mt-2.5 rounded-lg bg-amber-100 p-1 dark:bg-amber-950/60">
                <Slider value={[spots]} onValueChange={([v]) => setSpots(v)} size="lg" trackColorClass="bg-amber-400" trackBgClass="bg-transparent" className="w-full" />
              </div>
            </Tile>
            <Tile icon={Blinds} name="Blinds" state={blindsOpen ? 'Open · 100%' : 'Closed'} on={blindsOpen} onClick={() => setBlindsOpen((v) => !v)} />
            <Tile icon={Speaker} name="Nest mini" state={playing ? 'Playing' : 'Idle'} on={playing} onClick={() => setPlaying((v) => !v)} />
          </div>
        </div>
      </div>
    </div>
  );
}
