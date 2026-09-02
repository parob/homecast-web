/**
 * The real status panel, rendered against every state worth judging.
 *
 * This is NOT a mock: it imports the shipping `ConnectionSection`,
 * `ConnectionChain` and `buildChain`, inside the app's own Tailwind build. What
 * it fakes is only the *situation* — a stalled relay, a dead cloud relay, Local
 * Mode — because those cannot be induced on demand against a live socket.
 *
 * Dev-only. It is not routed, not linked, and not part of the production
 * bundle: Vite serves it because it is an HTML file in the project, and the
 * built app never references it.
 */

import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { buildChain, type ChainInput } from '@/lib/connection-chain';
import { ConnectionSection } from '@/components/layout/status/ConnectionSection';
import type { ChainVariant } from '@/components/layout/status/ConnectionChain';
import { serverConnection } from '@/server/connection';
import type { ConnectionQuality } from '@/server/connection-quality';
import '../src/index.css';

/**
 * `ConnectionSection`'s secondary line reads the live connection singleton.
 * Rather than fake the line, we feed the real function real-shaped numbers, so
 * what is screenshotted is the actual ranking logic choosing what to say.
 */
type Conn = { rtt: number | null; rttAt: number | null; inFlight: number | null; ping: number | null };
let CURRENT: Conn = { rtt: 34, rttAt: Date.now(), inFlight: null, ping: null };

serverConnection.getLastRttMs = () => CURRENT.rtt;
serverConnection.getLastRttAt = () => CURRENT.rttAt ?? 0;
serverConnection.getOldestInFlightMs = () => CURRENT.inFlight;
serverConnection.getPendingPingMs = () => CURRENT.ping;

interface Scene {
  title: string;
  note?: string;
  quality: ConnectionQuality;
  input: Partial<ChainInput>;
  conn: Conn;
}

const now = () => Date.now();

const SCENES: Scene[] = [
  {
    title: 'Healthy',
    note: 'Costs nothing to ignore. No label in the header, no motion.',
    quality: 'good',
    input: {},
    conn: { rtt: 34, rttAt: now(), inFlight: null, ping: null },
  },
  {
    title: 'Reaching Homecast is slow',
    note: 'Today this says “Your connection is slow”. The amber hop says which one.',
    quality: 'slow',
    input: { rtt: '1.4s' },
    conn: { rtt: 1400, rttAt: now(), inFlight: null, ping: null },
  },
  {
    title: 'Relay unreachable — self-hosted',
    note: 'The flagship. Phone and internet fine; the Mac is not answering.',
    quality: 'stalled',
    input: {},
    conn: { rtt: 28, rttAt: now(), inFlight: null, ping: 9000 },
  },
  {
    title: 'Relay unreachable — cloud plan',
    note: 'Identical broken hop, opposite advice. No button: nothing to restart.',
    quality: 'stalled',
    input: { managed: true },
    conn: { rtt: 31, rttAt: now(), inFlight: null, ping: 9000 },
  },
  {
    title: 'Offline',
    note: 'The near hop. This is the one where checking wifi is the right advice.',
    quality: 'offline',
    input: {},
    conn: { rtt: null, rttAt: null, inFlight: 12000, ping: null },
  },
  {
    title: 'Local Mode — a bypass, not a break',
    note: 'Cloud hop dead, home green. A break would be a lie.',
    quality: 'offline',
    input: { localMode: { active: true, unmapped: false } },
    conn: { rtt: null, rttAt: null, inFlight: null, ping: null },
  },
];

const BASE: ChainInput = {
  quality: 'good',
  reconnected: false,
  relayStatus: false,
  localMode: { active: false, unmapped: false },
  managed: false,
  selfRelay: false,
  community: false,
  rtt: '34ms',
};

/**
 * Sets the connection stub before its children render.
 *
 * React renders depth-first and synchronously, so a value written in this
 * body is the one this card's `ConnectionSection` reads — and the next card
 * overwrites it before its own.
 */
function Card({ scene, variant }: { scene: Scene; variant: ChainVariant }) {
  CURRENT = scene.conn;
  const chain = buildChain({ ...BASE, ...scene.input, quality: scene.quality });
  return (
    <div className="flex w-[300px] flex-col gap-2">
      <div>
        <p className="text-xs font-semibold">{scene.title}</p>
        {scene.note && <p className="text-[10.5px] text-muted-foreground">{scene.note}</p>}
      </div>
      {/* The real popover geometry: w-[280px] p-3, as StatusBadge renders it. */}
      <div className="w-[280px] rounded-md border bg-popover p-3 text-popover-foreground shadow-md">
        <ConnectionSection
          quality={scene.quality}
          headline="(unused under option C)"
          onReconnect={() => {}}
          chain={chain}
          chainVariant={variant}
        />
      </div>
    </div>
  );
}

function Variant({ variant, label, pitch }: { variant: ChainVariant; label: string; pitch: string }) {
  return (
    <section data-variant={variant} className="space-y-4 p-6">
      <div>
        <h2 className="text-base font-semibold">{label}</h2>
        <p className="max-w-[640px] text-xs text-muted-foreground">{pitch}</p>
      </div>
      <div className="flex flex-wrap gap-6">
        {SCENES.map(s => (
          <Card key={s.title} scene={s} variant={variant} />
        ))}
      </div>
    </section>
  );
}

function Harness() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Variant
        variant="nodes"
        label="1 — Nodes"
        pitch="Icon chips, names and connectors. The most explicit: every hop is named and the failing one is coloured and labelled in place. Most to read, and the widest."
      />
      <Variant
        variant="bar"
        label="2 — Bar"
        pitch="One capsule in three segments. The sleekest — two green and one amber tells the story with nothing read at all. Names sit under the joins rather than under icons."
      />
      <Variant
        variant="rail"
        label="3 — Rail"
        pitch="Vertical, one row per hop. The only one that never truncates a relay name, and the only one that still reads well as a bottom sheet."
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
