/**
 * What the pricing page sells: the four plans, and the two relay options they
 * split across — the same "Option 1 / Option 2" vocabulary as How it Works.
 */
import type { ReactNode } from 'react';
import { Laptop, Cloud, Check, AlertTriangle, Heart } from 'lucide-react';
import type { Pricing as PricingShape } from '@/lib/pricing';

export type Opt = 1 | 2;

export const OPTION = {
  1: { title: 'Self-Hosted Relay', sub: 'Run on your own Mac', icon: Laptop, pill: 'bg-primary/10 text-primary', iconBox: 'bg-primary/10 text-primary' },
  2: { title: 'Cloud Relay', sub: 'We run it for you', icon: Cloud, pill: 'bg-blue-500/10 text-blue-500', iconBox: 'bg-blue-500/10 text-blue-500' },
} as const;

export interface Tier {
  id: 'community' | 'basic' | 'standard' | 'cloud';
  name: string;
  price: string;
  per?: string;
  option: Opt;
  /** Part of Homecast Cloud (an account, remote access) — Community is not. */
  cloud: boolean;
  lines: ReactNode[];
  /** Community and Basic list caveats, not ticked features. */
  plain?: boolean;
  note?: ReactNode;
}

export function tiers(p: PricingShape): Tier[] {
  return [
    { id: 'community', name: 'Community', price: 'Free', option: 1, cloud: false, plain: true,
      lines: [<><strong>Unlimited</strong> accessories</>, 'Local network access only'],
      note: <>Remote access via Tailscale, Cloudflare Tunnel or similar</> },
    { id: 'basic', name: 'Basic', price: 'Free', option: 1, cloud: true, plain: true,
      lines: ['Limited to 10 accessories', 'Ad-supported'] },
    { id: 'standard', name: 'Standard', price: p.standard.formatted, per: '/month', option: 1, cloud: true,
      lines: [<><strong>Unlimited</strong> accessories</>, 'Push notifications', 'MQTT broker'] },
    { id: 'cloud', name: 'Cloud', price: p.cloud.formatted, per: '/month', option: 2, cloud: true,
      lines: [<><strong>Unlimited</strong> accessories</>, 'Push notifications', 'MQTT broker', 'No Mac required'],
      note: 'Requires an Apple Home Hub (Apple TV or HomePod) on your home network.' },
  ];
}

export function OptionPill({ n }: { n: Opt }) {
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${OPTION[n].pill}`}>
      Option {n}
    </span>
  );
}

/** The How it Works card header. `compact` drops the icon box, for a card too narrow for both it and the title. */
export function OptionHeader({ n, compact = false }: { n: Opt; compact?: boolean }) {
  const o = OPTION[n]; const Icon = o.icon;
  // min-h keeps a compact header level with a full one beside it, so tiles under both start together.
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {!compact && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${o.iconBox}`}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-tight">{o.title}</h3>
          <p className="text-sm text-muted-foreground">{o.sub}</p>
        </div>
      </div>
      <OptionPill n={n} />
    </div>
  );
}

const Line = ({ children, plain, dark }: { children: ReactNode; plain?: boolean; dark?: boolean }) =>
  plain
    ? <li className={`text-sm ${dark ? 'text-zinc-400 [&_strong]:text-zinc-200' : 'text-muted-foreground'}`}>{children}</li>
    : <li className="flex items-center gap-2 text-sm"><Check className="h-4 w-4 shrink-0 text-green-500" /><span>{children}</span></li>;

/** One plan tile. Community keeps the dark identity it has always had. */
export function Tile({ tier, className = '', rounded = 'rounded-xl', dense }: {
  tier: Tier;
  className?: string;
  /** Corner classes — a plain `rounded-none` in className would lose to the default. */
  rounded?: string;
  /** Tighter padding, for a tile nested inside other padded boxes. */
  dense?: boolean;
}) {
  const dark = tier.id === 'community';
  return (
    <div className={`relative flex flex-col ${rounded} ${dense ? 'p-4' : 'p-4 sm:p-5'} ${dark ? 'bg-zinc-900 text-zinc-100' : 'bg-slate-50 dark:bg-slate-800/30'} ${className}`}>
      <div className="mb-3 sm:mb-4">
        <h5 className="mb-1 text-base font-semibold">{tier.name}</h5>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold sm:text-3xl">{tier.price}</span>
          {tier.per && <span className={`text-sm ${dark ? 'text-zinc-400' : 'text-muted-foreground'}`}>{tier.per}</span>}
        </div>
      </div>
      <ul className="flex-1 space-y-2">
        {tier.lines.map((l, i) => <Line key={i} plain={tier.plain} dark={dark}>{l}</Line>)}
      </ul>
      {tier.note && (
        <div className={`mt-4 border-t pt-3 text-xs ${dark ? 'border-zinc-700 text-zinc-400' : 'border-border text-muted-foreground'}`}>
          {tier.note}
          {dark && (
            <div className="mt-3 space-y-2">
              <div className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Some technical knowledge required</div>
              <div className="flex items-start gap-1.5"><Heart className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Open source under the MIT licence</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
