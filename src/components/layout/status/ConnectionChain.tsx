/**
 * The path to your home, drawn.
 *
 * Option C of parob/homecast-cloud#38: the chain *is* the content of the status
 * panel, and the sentence naming the broken hop is the headline. The model it
 * renders is `lib/connection-chain.ts` — this file is presentation only, and
 * takes a plain `ChainModel` so it can be rendered against any state without a
 * live socket.
 *
 * Three variants, because "which hop" and "how sleek" pull in opposite
 * directions and the right trade is a judgement call:
 *
 *   `nodes`  icons, names, connectors — the most explicit, the most to read
 *   `bar`    one capsule in three segments — the sleekest; two green and one
 *            amber tells the story with no reading at all
 *   `rail`   one row per hop, vertical — handles long relay names, and reads
 *            best when the panel has vertical room to spend
 *
 * `idle` is drawn dashed rather than coloured everywhere, because it means "no
 * claim" — nothing beyond a dead hop has been measured, and painting it would
 * invent evidence.
 */

import { cn } from '@/lib/utils';
import { Cloud, House, Server, Smartphone } from 'lucide-react';
import type { ChainModel, ChainNodeKey, ChainTone } from '@/lib/connection-chain';

export type ChainVariant = 'nodes' | 'bar' | 'rail';

const ICONS: Record<ChainNodeKey, typeof Cloud> = {
  device: Smartphone,
  cloud: Cloud,
  relay: Server,
  home: House,
};

/** Solid fills, for dots and segments. */
const FILL: Record<ChainTone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  idle: 'bg-muted-foreground/25',
};

/** Text and icon colour. `ok` is deliberately muted — healthy costs nothing to ignore. */
const INK: Record<ChainTone, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  idle: 'text-muted-foreground/50',
};

/** The tinted disc behind an icon. */
const CHIP: Record<ChainTone, string> = {
  ok: 'bg-emerald-500/10 ring-emerald-500/25',
  warn: 'bg-amber-500/15 ring-amber-500/35',
  bad: 'bg-red-500/15 ring-red-500/35',
  idle: 'bg-muted-foreground/10 ring-muted-foreground/15',
};

interface ConnectionChainProps {
  model: ChainModel;
  variant?: ChainVariant;
  className?: string;
}

export function ConnectionChain({ model, variant = 'nodes', className }: ConnectionChainProps) {
  if (variant === 'bar') return <BarChain model={model} className={className} />;
  if (variant === 'rail') return <RailChain model={model} className={className} />;
  return <NodesChain model={model} className={className} />;
}

/* ── nodes ─────────────────────────────────────────────────────────────────
 * Icon chips with connectors. The hop label rides above its own connector, so
 * "no answer" sits on the hop it describes rather than under a node it does
 * not. Labels are absolutely positioned and need top clearance — without it
 * they collide with whatever the panel puts above the chain.
 */
function NodesChain({ model, className }: { model: ChainModel; className?: string }) {
  return (
    <div className={cn('flex items-start pt-3.5', className)}>
      {model.nodes.map((node, i) => {
        const Icon = ICONS[node.key];
        const hop = i > 0 ? model.hops[i - 1] : null;
        return (
          <div key={node.key} className="contents">
            {hop && (
              <div className="relative mt-[13px] h-[2px] min-w-[14px] flex-1">
                <span
                  className={cn(
                    'absolute inset-0 rounded-full',
                    hop.tone === 'idle'
                      ? 'border-t-2 border-dashed border-muted-foreground/30'
                      : FILL[hop.tone],
                  )}
                />
                {hop.label && (
                  <span
                    className={cn(
                      'absolute -top-[15px] left-1/2 -translate-x-1/2 whitespace-nowrap',
                      'text-[9px] font-medium leading-none',
                      INK[hop.tone],
                    )}
                  >
                    {hop.label}
                  </span>
                )}
              </div>
            )}
            <div className="flex w-[52px] shrink-0 flex-col items-center gap-1">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full ring-1',
                  CHIP[node.tone],
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', INK[node.tone])} strokeWidth={2} />
              </span>
              <span
                className={cn(
                  'text-center text-[9.5px] leading-tight',
                  node.tone === 'ok' ? 'text-muted-foreground' : INK[node.tone],
                )}
              >
                {node.name}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── bar ───────────────────────────────────────────────────────────────────
 * One capsule, three segments, no icons. The sleekest of the three: two green
 * and one amber says which hop without a word being read. Names sit underneath
 * spread across the capsule, so the segment and the pair of names it joins line
 * up without needing a connector drawn between them.
 */
function BarChain({ model, className }: { model: ChainModel; className?: string }) {
  const brokenIndex = model.hops.findIndex(h => h.tone === 'warn' || h.tone === 'bad');
  const broken = brokenIndex >= 0 ? model.hops[brokenIndex] : null;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-1">
        {model.hops.map((hop, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              hop.tone === 'idle'
                ? 'bg-[repeating-linear-gradient(90deg,hsl(var(--muted-foreground)/0.3)_0_3px,transparent_3px_6px)]'
                : FILL[hop.tone],
            )}
          />
        ))}
      </div>
      <div className="flex justify-between">
        {model.nodes.map((node, i) => (
          <span
            key={node.key}
            className={cn(
              'text-[9.5px] leading-tight',
              i === 0 ? 'text-left' : i === model.nodes.length - 1 ? 'text-right' : 'text-center',
              node.tone === 'ok' || node.tone === 'idle' ? 'text-muted-foreground' : INK[node.tone],
            )}
          >
            {node.name}
          </span>
        ))}
      </div>
      {/*
        The label has to sit under the segment it is about. Left-aligning it
        under the whole capsule put "no answer" beneath "This device" while the
        dead hop was the second one — the chain's entire job, stated wrongly.
        So it rides a row with the same three flex children as the capsule.
      */}
      {broken?.label && (
        <div className="flex gap-1">
          {model.hops.map((_, i) => (
            <span key={i} className="flex-1 text-center">
              {i === brokenIndex && (
                <span className={cn('text-[10px] font-medium', INK[broken.tone])}>
                  {broken.label}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── rail ──────────────────────────────────────────────────────────────────
 * Vertical, one row per node, stems between them. The only variant that never
 * has to truncate a relay name, and the only one that stays readable when the
 * panel is a bottom sheet rather than a 280px popover.
 */
function RailChain({ model, className }: { model: ChainModel; className?: string }) {
  return (
    <div className={cn('space-y-0', className)}>
      {model.nodes.map((node, i) => {
        const Icon = ICONS[node.key];
        const hop = i > 0 ? model.hops[i - 1] : null;
        return (
          <div key={node.key}>
            {hop && (
              <div className="flex items-center gap-2 pl-[11px]">
                <span
                  className={cn(
                    'h-3.5 w-[2px] rounded-full',
                    hop.tone === 'idle'
                      ? 'border-l-2 border-dashed border-muted-foreground/30 bg-transparent'
                      : FILL[hop.tone],
                  )}
                />
                {hop.label && (
                  <span className={cn('text-[9.5px] font-medium leading-none', INK[hop.tone])}>
                    {hop.label}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1',
                  CHIP[node.tone],
                )}
              >
                <Icon className={cn('h-3 w-3', INK[node.tone])} strokeWidth={2} />
              </span>
              <span
                className={cn(
                  'text-[11px] leading-none',
                  node.tone === 'ok' ? 'text-foreground/80' : INK[node.tone],
                )}
              >
                {node.name}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
