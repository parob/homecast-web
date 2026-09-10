/**
 * The status popover's body: one answer, then its evidence, then two rows.
 *
 * Renders the model from `lib/answer-card.ts` — presentation only, so it can
 * be drawn against any state without a live socket (the dev preview at
 * /dev/reliability does exactly that). The order is the model's and is fixed:
 * verdict, because, the chain only when a hop is not green, at most one
 * action.
 *
 * The two rows at the bottom are not part of the answer. `ReliabilityRow` is
 * history — one figure and a link to the page that holds the strip and the
 * outage list — and `RelayRow` is this Mac's duty, one word and a link to
 * Settings → Relay, where the uptime, client and subscription figures that used
 * to be printed here have always also lived. Neither shows a *live* status:
 * the verdict owns "now", and a second live status under it is how the popover
 * came to say "Offline" over a home that worked.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { ChevronRight, Info, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { GET_HOME_UPTIME } from '@/lib/graphql/queries';
import type { UptimeSummary } from '@/components/settings/UptimeSection';
import type { AnswerCard, CardTone } from '@/lib/answer-card';
import { relaySectionState, type RelayConnectionState, type RelaySectionState } from '@/lib/relay-section-state';
import { serverConnection } from '@/server/connection';
import { useHomes } from '@/hooks/useHomeKitData';
import { effectiveServing, getThisDevice, subscribeHomeServing } from '@/server/home-serving';
import { ConnectionChain } from './ConnectionChain';

const DOT: Record<CardTone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  idle: 'bg-muted-foreground/40',
};

interface AnswerCardViewProps {
  card: AnswerCard;
  /**
   * The one piece of live evidence the model does not carry: what the socket
   * is waiting on right now ("A request has been waiting 6s."). Shown under the
   * sentence only while the link is the thing being complained about.
   */
  evidence?: string | null;
  onReconnect: () => void;
}

export function AnswerCardView({ card, evidence, onReconnect }: AnswerCardViewProps) {
  return (
    <div className="space-y-3">
      <div>
        {/*
          The dot is inline in the sentence rather than a flex sibling of it.
          As a flex row it indented the verdict by the dot plus the gap, while
          `because`, `evidence` and `via` — siblings of the *row*, not of the
          sentence — fell back to the card's content edge. The headline was the
          only thing in the card on its own left edge, which is the ragged edge
          in parob/homecast-cloud#113. Inline, every line of the card starts in
          the same column, a wrapped verdict included.
        */}
        <p className="text-[15px] font-semibold leading-snug tracking-[-0.005em]">
          <span
            className={cn(
              'mr-2 inline-block h-2 w-2 rounded-full align-middle',
              DOT[card.tone],
              card.pulse && 'motion-safe:animate-pulse',
            )}
          />
          {card.verdict}
        </p>
        {card.because && (
          <p className="mt-1.5 text-[12.5px] leading-snug text-foreground/75">{card.because}</p>
        )}
        {evidence && (
          <p className="mt-1 text-[11px] text-muted-foreground">{evidence}</p>
        )}
        {!card.showChain && card.via && (
          <p className="mt-1.5 text-[11.5px] tabular-nums text-muted-foreground">{card.via}</p>
        )}
      </div>

      {card.showChain && <ConnectionChain model={card.chain} variant="rail" />}

      {card.caveat && (
        <p className="text-[11.5px] leading-snug text-amber-600 dark:text-amber-400">{card.caveat}</p>
      )}

      {/*
        The one action a user can actually take, offered only when it fixes the
        fault being reported. `serverConnection.reconnect()` tears the socket
        down and builds a new one, rejecting every in-flight request — on a
        healthy connection that is a footgun, and against a dead cloud relay it
        rebuilds something that was never broken. The model decides; this only
        draws.
      */}
      {card.note && (
        <div className="flex gap-2 rounded-md bg-muted/50 p-2">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-snug text-muted-foreground">{card.note}</p>
        </div>
      )}
      {card.reconnect && (
        <Button variant="outline" size="sm" className="w-full" onClick={onReconnect}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Reconnect now
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The two rows.
// ---------------------------------------------------------------------------

interface RowProps {
  label: string;
  value: string;
  tone?: CardTone | null;
  pulse?: boolean;
  onOpen?: () => void;
}

/** One line: a muted label, a value, a chevron when it opens something. */
export function StatusRow({ label, value, tone, pulse, onOpen }: RowProps) {
  const inner = (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
        {tone && (
          <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone], pulse && 'motion-safe:animate-pulse')} />
        )}
        {value}
        {/*
          `-mr-1` is optical, not spacing. Lucide's chevron-right draws at
          x=9..15 of a 24 viewBox, so a 12px icon sitting flush leaves 4.5px of
          empty box past the ink and the row stops visibly short of the rule
          above it. Pulling the box out by 4 puts the glyph on the same edge as
          everything else.
        */}
        {onOpen && <ChevronRight className="-mr-1 h-3 w-3 text-muted-foreground" />}
      </span>
    </>
  );
  const cls = 'flex w-full items-center justify-between gap-2 py-1.5 text-xs';
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(cls, 'hover:text-foreground text-left')}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function pct(v: number): string {
  if (v >= 99.95) return '100%';
  return `${v.toFixed(v >= 10 ? 0 : 1)}%`;
}

interface ReliabilityRowProps {
  homeId: string;
  /** Opens Settings → the home → Reliability. Absent hides the chevron. */
  onOpen?: () => void;
}

/**
 * `92% this week ›`. Reads the same query as the Reliability page, with the
 * same variables, so opening the popover after the page costs nothing. Mounted
 * only while the popover is open.
 */
export function ReliabilityRow({ homeId, onOpen }: ReliabilityRowProps) {
  const { data } = useQuery<{ homeUptime: UptimeSummary }>(GET_HOME_UPTIME, {
    variables: { homeId, days: 30 },
    fetchPolicy: 'cache-and-network',
  });
  const s = data?.homeUptime;
  return (
    <StatusRow
      label="Reliability"
      value={s ? `${pct(s.uptimePercent7d)} this week` : 'checking…'}
      onOpen={onOpen}
    />
  );
}

const DUTY: Record<RelaySectionState, { value: string; tone: CardTone; pulse?: boolean }> = {
  connected_active: { value: 'Active relay', tone: 'ok' },
  connected_standby: { value: 'Standing by', tone: 'ok' },
  connected_cloud_standby: { value: 'Standing by', tone: 'ok' },
  connected_cloud_waiting: { value: 'Taking over…', tone: 'warn', pulse: true },
  connected_cloud_serving: { value: 'Standing in', tone: 'warn' },
  connected_cloud_offline: { value: 'Standing by', tone: 'idle' },
  connecting: { value: 'Connecting…', tone: 'idle', pulse: true },
  reconnecting: { value: 'Reconnecting…', tone: 'idle', pulse: true },
  disconnected: { value: 'Disconnected', tone: 'bad' },
};

interface RelayRowProps {
  /** Opens Settings → Relay. Absent hides the chevron. */
  onOpen?: () => void;
}

/**
 * `This Mac · Standing by ›`. What this Mac's relay is doing, folded from the
 * one serving fact per home by `relaySectionState`. The take-over button, the
 * uptime, the client and subscription counts are all on the page this opens.
 */
export function RelayRow({ onOpen }: RelayRowProps) {
  const [connectionState, setConnectionState] = useState<RelayConnectionState>(
    () => serverConnection.getState().connectionState,
  );
  // The socket state is sampled while this is on screen — a second is the
  // cadence the old section used, and it is only ever running while open.
  useEffect(() => {
    const t = setInterval(() => setConnectionState(serverConnection.getState().connectionState), 1000);
    return () => clearInterval(t);
  }, []);
  const [, bumpServing] = useState(0);
  useEffect(() => subscribeHomeServing(() => bumpServing(n => n + 1)), []);
  const { data: homes } = useHomes();

  const verdict = relaySectionState({
    connectionState,
    community: false,
    homes: homes ?? [],
    serving: effectiveServing,
    thisDevice: getThisDevice(),
  });
  const duty = DUTY[verdict.state];
  return <StatusRow label="This Mac" value={duty.value} tone={duty.tone} pulse={duty.pulse} onOpen={onOpen} />;
}
