/**
 * The plan section: two outlined option cards, one "Homecast Cloud" box
 * wrapping the three plans that need an account — straight across the seam
 * between the cards — and "Every plan includes" beneath. There is no
 * comparison chart: each tile lists only what sets it apart.
 */
import type { ReactNode } from 'react';
import { Cloud } from 'lucide-react';
import type { Pricing as PricingShape } from '@/lib/pricing';
import { IncludedEverywhere } from './IncludedEverywhere';
import { tiers, Tile, OptionHeader } from './plans';

const card = 'rounded-2xl border border-border/60 bg-slate-50 p-5 dark:bg-slate-800/30';
/** The outlined card, as a background layer behind the merged header's grid cells. */
const cardShell = 'rounded-2xl border border-border/60 bg-slate-50 dark:bg-slate-800/30';

/** The inner box. Its label and children are direct grid children, so it can be a subgrid. */
function CloudBox({ children, className = '', dense }: { children: ReactNode; className?: string; dense?: boolean }) {
  return (
    <div className={`rounded-xl border border-border bg-background/40 ${dense ? 'p-2.5' : 'p-3'} ${className}`}>
      <div className="col-span-full mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground"><Cloud className="h-3.5 w-3.5" /> Homecast Cloud</div>
      {children}
    </div>
  );
}

export function PlanSection({ pricing }: { pricing: PricingShape }) {
  const [community, basic, standard, cloud] = tiers(pricing);
  return (
    <>
      {/* Desktop: three layers on one grid — the outlined option cards (rows 1–3), one Homecast
          Cloud box around Basic → Cloud (rows 2–3) straight across the seam between the cards, and
          the headers, label and tiles on top. Insets, in px: 22-ish at a card's outer edge (6 margin
          + 16 padding), 10 inside the box, chosen so every gap between tiles is 23 — across the card
          seam too, where each card keeps only 5–6 inside its border. The 6px column between Standard
          and Cloud belongs to the Option 2 card and makes that sum come out. */}
      <div className="hidden lg:grid grid-cols-[repeat(3,minmax(0,1fr))_6px_minmax(0,1fr)] grid-rows-[auto_auto_1fr]">
        <div className={`${cardShell} col-start-1 col-span-3 row-start-1 row-span-3 mx-1.5`} />
        <div className={`${cardShell} col-start-4 col-span-2 row-start-1 row-span-3 mx-1.5`} />
        <div className="col-start-2 col-span-4 row-start-2 row-span-2 ml-[9px] mr-[12px] my-4 rounded-xl border border-border/60 bg-background/70" />

        <div className="col-start-1 col-span-3 row-start-1 mx-1.5 px-4 pt-4"><OptionHeader n={1} /></div>
        <div className="col-start-4 col-span-2 row-start-1 mx-1.5 px-4 pt-4"><OptionHeader n={2} compact /></div>

        <div className="col-start-2 col-span-4 row-start-2 ml-[23px] mr-[22px] mt-[26px] flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Cloud className="h-3.5 w-3.5" /> Homecast Cloud
        </div>

        <Tile tier={community} dense className="col-start-1 row-start-3 ml-[23px] mr-[4px] mt-2 mb-[26px]" />
        <Tile tier={basic} dense className="col-start-2 row-start-3 ml-[19px] mr-[8px] mt-2 mb-[26px] border border-border/60 bg-background" />
        <Tile tier={standard} dense className="col-start-3 row-start-3 ml-[15px] mr-[12px] mt-2 mb-[26px] border border-border/60 bg-background" />
        <Tile tier={cloud} dense className="col-start-5 row-start-3 ml-[5px] mr-[22px] mt-2 mb-[26px] border border-border/60 bg-background" />
      </div>


      {/* Stacked: the two cards, then the table with its own header */}
      <div className="lg:hidden">
        <div className="grid gap-6">
          <div className={card}>
            <OptionHeader n={1} />
            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr]">
              <Tile tier={community} />
              <CloudBox>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Tile tier={basic} className="bg-background" />
                  <Tile tier={standard} className="bg-background" />
                </div>
              </CloudBox>
            </div>
          </div>
          <div className={card}>
            <OptionHeader n={2} />
            <CloudBox className="mt-5">
              <Tile tier={cloud} className="bg-background" />
            </CloudBox>
          </div>
        </div>
      </div>

      <IncludedEverywhere />
    </>
  );
}
