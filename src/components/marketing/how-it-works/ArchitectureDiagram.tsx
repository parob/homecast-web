/**
 * The How it Works architecture diagram, lg and up: four stages on one
 * continuous rail — Devices, Apple Home Hub, Homecast Relay, Homecast App —
 * with a chevron in each gap and no arrowheads. The relay's two options sit
 * beneath it as symmetrical halves; the app's three platform renders sit on
 * the rail as the last stage's marker, with the APIs beneath. Below lg the
 * stages stack, with the option cards after them.
 */
import { useRef } from 'react';
import { Laptop, Cloud } from 'lucide-react';
import { OPTION, type Opt } from '@/components/marketing/pricing/plans';
import { MacMiniIcon } from './icons';
import { Stage, DevicesHouse, HubIcon, HubDevices, RelayIcon, AppsStage, OptionCards, MobileFlow, ArrowLayer, useArrows } from './diagram-parts';

function Half({ n }: { n: Opt }) {
  const o = OPTION[n];
  return (
    <div className="flex min-w-0 flex-col items-center px-2 text-center">
      <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${o.pill}`}>Option {n}</span>
      <div className="mt-1.5 text-xs font-semibold">{o.title}</div>
      <div className="text-[10px] text-muted-foreground">{o.sub}</div>
      <div className="mt-2 flex justify-center gap-3 pb-0.5">
        {n === 1 ? (
          <>
            <div className="flex flex-col items-center"><MacMiniIcon /><span className="text-[9px] text-muted-foreground">Mac mini</span></div>
            <div className="flex flex-col items-center"><Laptop className="h-6 w-6 text-foreground" /><span className="text-[9px] text-muted-foreground">MacBook</span></div>
          </>
        ) : (
          <div className="flex flex-col items-center"><Cloud className="h-6 w-6 text-foreground" /><span className="text-[9px] text-muted-foreground">homecast.cloud</span></div>
        )}
      </div>
    </div>
  );
}

export function ArchitectureDiagram() {
  const box = useRef<HTMLDivElement>(null);
  const i1 = useRef<HTMLDivElement>(null), i2 = useRef<HTMLDivElement>(null), i3 = useRef<HTMLDivElement>(null);
  const appBox = useRef<HTMLDivElement>(null), appMarker = useRef<HTMLDivElement>(null);
  const layers = useArrows(box, (rect) => {
    const [a, b, r, am] = [i1, i2, i3, appMarker].map((x) => rect(x.current));
    if (!a || !b || !r || !am) return [];
    const y = a.y + a.height / 2;
    const chevron = (x: number) => ({ d: `M ${x - 3} ${y - 4} L ${x + 1} ${y} L ${x - 3} ${y + 4}`, cap: 'round' as const });
    return [
      // the track, first icon's centre to the last marker's centre, drawn behind everything
      { d: `M ${a.x + a.width / 2} ${y} L ${am.x + am.width / 2} ${y}`, width: 8, cap: 'round' as const },
      chevron((a.right + b.left) / 2), chevron((b.right + r.left) / 2), chevron((r.right + am.left) / 2),
    ];
  });
  return (
    <div className="lg:p-8 lg:pr-12">
      <div ref={box} className="relative hidden lg:block">
        <ArrowLayer arrows={layers.slice(0, 1)} className="text-muted" />
        <ArrowLayer arrows={layers.slice(1)} className="text-muted-foreground" />
        <div className="relative grid items-start gap-5" style={{ gridTemplateColumns: '1fr 1fr 1.9fr 1.45fr' }}>
          <Stage icon={<DevicesHouse innerRef={i1} />} label="Your Smart Devices" />
          <Stage icon={<HubIcon innerRef={i2} />} label="Apple Home Hub"><HubDevices /></Stage>
          <div className="flex flex-col items-center">
            <div className="flex h-[72px] items-center justify-center"><RelayIcon innerRef={i3} /></div>
            <span className="mt-3 text-base font-medium">Homecast Relay</span>
            <div className="mt-3 grid w-full grid-cols-2 divide-x divide-border">
              <Half n={1} />
              <Half n={2} />
            </div>
          </div>
          <AppsStage boxRef={appBox} markerRef={appMarker} thumbsOnRail />
        </div>
      </div>
      <MobileFlow><OptionCards className="mt-8 w-full" /></MobileFlow>
    </div>
  );
}
