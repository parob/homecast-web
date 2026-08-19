/**
 * Community relay: the web app's half of the anonymous daily usage report.
 *
 * Swift owns the report — the install id, the day boundary, the counters the
 * HTTP/WebSocket server can see, and the send itself (`TelemetryReporter.swift`).
 * It cannot own the rest: the accessory census lives in HomeKit and the
 * automation, user and token counts live in IndexedDB, and neither is readable
 * from Swift. So this side gathers those and pushes them down over the same
 * bridge `advertise` uses, and Swift holds them until it sends.
 *
 * Two cadences, for two different costs:
 *
 * - **counters** every 15 minutes — in-memory integers, drained and reset, so a
 *   WebView reload loses at most a quarter hour of counting;
 * - **snapshot** every 6 hours — the census, which touches HomeKit. It goes
 *   through `communityRequest`, whose 5-minute cache the dashboard is already
 *   filling, so in practice it costs nothing beyond what the app already does.
 *
 * Only counts leave this file. No names, no ids, no characteristic values, no
 * broker hosts. `buildSnapshot` is pure and unit-tested so that stays provable
 * rather than asserted.
 *
 * ## Fail-silent
 *
 * A Community user must never see this fail. Nothing here throws into a caller:
 * `bumpTelemetry` is a bare integer increment with no imports and no awaits, and
 * the collection cycle runs inside its own timer with every step caught. It
 * deliberately does **not** use `console.error`/`console.warn` — those are
 * bridged to `NSLog` on the relay, so a failure here would otherwise show up in
 * the user's own console log.
 *
 * This module is a **leaf**: it has no static imports, so it can be imported
 * from `local-db` and `local-handler` without any risk of a cycle.
 */

/** How often drained counters are pushed down to Swift. */
const PUSH_COUNTERS_MS = 15 * 60 * 1000;
/** How often the HomeKit + IndexedDB census is retaken. */
const PUSH_SNAPSHOT_MS = 6 * 60 * 60 * 1000;
/** First census, once the relay has settled after start. */
const FIRST_SNAPSHOT_MS = 2 * 60 * 1000;

// --- Counters -------------------------------------------------------------

/** Counter names Swift will accept. Anything else is dropped on arrival. */
export type TelemetryCounter =
  | 'characteristicWrites'
  | 'sceneRuns'
  | 'automationRuns'
  | 'automationErrors';

let counters: Partial<Record<TelemetryCounter, number>> = {};

/**
 * Count one occurrence. Safe to call from anywhere, including hot paths — it is
 * a property increment with no I/O, and it never throws.
 */
export function bumpTelemetry(key: TelemetryCounter, n = 1): void {
  counters[key] = (counters[key] ?? 0) + n;
}

/** Take the accumulated counts and start a fresh window. */
export function drainTelemetryCounters(): Record<string, number> {
  const drained = counters;
  counters = {};
  return drained as Record<string, number>;
}

/** Test seam. */
export function resetTelemetryForTest(): void {
  counters = {};
  stopTimers();
  started = false;
}

// --- Payload shapes -------------------------------------------------------

export interface TelemetryScale {
  homes: number;
  rooms: number;
  zones: number;
  accessories: number;
  accessoriesOnline: number;
  scenes: number;
  serviceGroups: number;
  hkAutomations: number;
  hcAutomations: number;
  virtualAccessories: number;
  users: number;
  webhooks: number;
  apiTokens: number;
  oauthClients: number;
}

export interface TelemetryFeatures {
  authEnabled: boolean;
  mqttBrokers: number;
  historyEnabled: boolean;
  developerMode: boolean;
}

export interface TelemetrySnapshot {
  scale: TelemetryScale;
  categories: Record<string, number>;
  features: TelemetryFeatures;
}

/** Everything `buildSnapshot` needs, so the shaping stays a pure function. */
export interface SnapshotInput {
  stats: {
    homes?: number;
    rooms?: number;
    zones?: number;
    accessories?: number;
    accessoriesOnline?: number;
    scenes?: number;
    serviceGroups?: number;
  } | null;
  /** Device type per accessory, as classified by `getDeviceType`. */
  accessoryTypes: string[];
  hkAutomations: number;
  hcAutomations: number;
  virtualAccessories: number;
  users: number;
  webhooks: number;
  apiTokens: number;
  oauthClients: number;
  authEnabled: boolean;
  mqttBrokers: number;
  historyEnabled: boolean;
  developerMode: boolean;
}

/**
 * Fold a list of device types into a histogram.
 *
 * Long-tail types collapse into `other` so the fleet view stays readable and a
 * one-of-a-kind accessory in one home cannot become a column of its own —
 * which, across a small fleet, would edge towards identifying that home.
 */
export function categoriseAccessories(types: string[]): Record<string, number> {
  const KNOWN = new Set([
    'light', 'switch', 'outlet', 'climate', 'lock', 'alarm', 'motion', 'contact',
    'temperature', 'fan', 'blind', 'valve', 'speaker', 'light_sensor', 'doorbell',
    'button',
  ]);
  const out: Record<string, number> = {};
  for (const type of types) {
    const key = KNOWN.has(type) ? type : 'other';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Shape the gathered facts into the snapshot Swift merges into the report. */
export function buildSnapshot(input: SnapshotInput): TelemetrySnapshot {
  const stats = input.stats ?? {};
  const n = (value: number | undefined) => (Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0);

  return {
    scale: {
      homes: n(stats.homes),
      rooms: n(stats.rooms),
      zones: n(stats.zones),
      // The census is the authority on how many accessories there are: it is
      // the same list the categories come from, so the two can never disagree.
      accessories: input.accessoryTypes.length || n(stats.accessories),
      accessoriesOnline: n(stats.accessoriesOnline),
      scenes: n(stats.scenes),
      serviceGroups: n(stats.serviceGroups),
      hkAutomations: n(input.hkAutomations),
      hcAutomations: n(input.hcAutomations),
      virtualAccessories: n(input.virtualAccessories),
      users: n(input.users),
      webhooks: n(input.webhooks),
      apiTokens: n(input.apiTokens),
      oauthClients: n(input.oauthClients),
    },
    categories: categoriseAccessories(input.accessoryTypes),
    features: {
      authEnabled: !!input.authEnabled,
      mqttBrokers: n(input.mqttBrokers),
      historyEnabled: !!input.historyEnabled,
      developerMode: !!input.developerMode,
    },
  };
}

// --- Bridge ---------------------------------------------------------------

interface LocalServerHandler {
  postMessage: (msg: unknown) => void;
}

function nativeBridge(): LocalServerHandler | undefined {
  const win = window as Window & {
    webkit?: { messageHandlers?: { localServer?: LocalServerHandler } };
  };
  return win.webkit?.messageHandlers?.localServer;
}

function pushCounters(): void {
  try {
    const drained = drainTelemetryCounters();
    if (Object.keys(drained).length === 0) return;
    const bridge = nativeBridge();
    if (!bridge) return;
    bridge.postMessage({ action: 'telemetry', kind: 'counters', counters: drained });
  } catch {
    // Deliberately silent — see the fail-silent note at the top.
  }
}

async function pushSnapshot(): Promise<void> {
  try {
    const bridge = nativeBridge();
    if (!bridge) return;
    const snapshot = await collectSnapshot();
    if (!snapshot) return;
    bridge.postMessage({ action: 'telemetry', kind: 'snapshot', snapshot });
  } catch {
    // Deliberately silent.
  }
}

// --- Collection -----------------------------------------------------------

/** Best-effort: a step that fails contributes its fallback, not an exception. */
async function attempt<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * The array inside a relay action's response envelope, or an empty one.
 *
 * Relay actions answer `{homes: [...]}`, `{accessories: [...]}` and so on — a
 * named wrapper, never a bare array. Reading one as an array yields an object,
 * and iterating an object throws. Tolerating a bare array too means this keeps
 * working if an action is ever unwrapped.
 */
export function listOf<T>(response: unknown, key: string): T[] {
  if (Array.isArray(response)) return response as T[];
  const inner = (response as Record<string, unknown> | null)?.[key];
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/**
 * Take the census. Every source is independently guarded, so a relay whose
 * HomeKit is unavailable still reports its IndexedDB counts and vice versa.
 */
export async function collectSnapshot(): Promise<TelemetrySnapshot | null> {
  const [{ HomeKit }, { communityRequest }, db, history, mqtt, rest] = await Promise.all([
    import('../native/homekit-bridge'),
    import('./connection'),
    import('./local-db'),
    import('./local-history'),
    import('../lib/mqtt-bridge'),
    import('./local-rest'),
  ]);

  const stats = await attempt(() => HomeKit.getStats(), null);

  // Accessories and HomeKit automations are per-home, so the home list comes
  // first. `communityRequest` is the cached path the dashboard already uses —
  // going direct to the bridge would double the HomeKit work.
  //
  // Every relay action answers with a NAMED WRAPPER, never a bare array:
  // `homes.list` -> {homes}, `accessories.list` -> {accessories},
  // `automations.list` -> {automations}. Reading them as arrays made
  // `for...of` throw outside the per-call guard below, which rejected the whole
  // census — silently, because pushSnapshot swallows by design. The result was
  // a relay reporting real request counts and a completely empty topology.
  const homes = listOf<{ id: string }>(
    await attempt(() => communityRequest<unknown>('homes.list', {}), null),
    'homes',
  );

  const accessoryTypes: string[] = [];
  let hkAutomations = 0;
  for (const home of homes) {
    const accessories = listOf<Record<string, unknown>>(
      await attempt(() => communityRequest<unknown>('accessories.list', { homeId: home.id }), null),
      'accessories',
    );
    for (const accessory of accessories) {
      accessoryTypes.push(rest.getDeviceType(accessory));
    }
    const automations = listOf<unknown>(
      await attempt(() => communityRequest<unknown>('automations.list', { homeId: home.id }), null),
      'automations',
    );
    hkAutomations += automations.length;
  }

  const [
    hcAutomations, virtualAccessories, users, webhooks, apiTokens, oauthClients,
    authEnabled, historyConfigs, brokers, settingsBlob,
  ] = await Promise.all([
    attempt(() => db.getHcAutomations(), []),
    attempt(() => db.getVirtualAccessories(), []),
    attempt(() => db.getUsers(), []),
    attempt(() => db.getWebhooks(), []),
    attempt(() => db.getAccessTokens(), []),
    attempt(() => db.getAllOAuthClients(), []),
    attempt(async () => (await db.getSetting('auth-enabled')) === 'true', false),
    attempt(() => history.getHistoryHomeConfigs(), {} as Record<string, { enabled: boolean }>),
    // Broker *count* only. The host, username and topic prefix stay here.
    attempt(() => mqtt.getMQTTBrokers(), {} as Record<string, unknown[]>),
    attempt(() => db.getSettings(), '{}'),
  ]);

  let developerMode = false;
  try {
    developerMode = JSON.parse(settingsBlob)?.developerMode === true;
  } catch {
    developerMode = false;
  }

  return buildSnapshot({
    stats,
    accessoryTypes,
    hkAutomations,
    hcAutomations: hcAutomations.length,
    virtualAccessories: virtualAccessories.length,
    users: users.length,
    webhooks: webhooks.length,
    apiTokens: apiTokens.length,
    oauthClients: oauthClients.length,
    authEnabled,
    mqttBrokers: Object.values(brokers).reduce((sum, list) => sum + (list?.length ?? 0), 0),
    historyEnabled: Object.values(historyConfigs).some((config) => config?.enabled === true),
    developerMode,
  });
}

// --- Lifecycle ------------------------------------------------------------

let started = false;
let counterTimer: ReturnType<typeof setInterval> | null = null;
let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let firstSnapshotTimer: ReturnType<typeof setTimeout> | null = null;

function stopTimers(): void {
  if (counterTimer) clearInterval(counterTimer);
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (firstSnapshotTimer) clearTimeout(firstSnapshotTimer);
  counterTimer = snapshotTimer = null;
  firstSnapshotTimer = null;
}

/**
 * Start pushing to Swift. Called from `initLocalServer`, after its relay gate —
 * a phone, a LAN browser or a Mac in client mode never reaches this, so a
 * household reports once rather than once per device.
 */
export function initTelemetry(): void {
  if (started) return;
  if (!nativeBridge()) return;
  started = true;

  counterTimer = setInterval(pushCounters, PUSH_COUNTERS_MS);
  firstSnapshotTimer = setTimeout(() => { void pushSnapshot(); }, FIRST_SNAPSHOT_MS);
  snapshotTimer = setInterval(() => { void pushSnapshot(); }, PUSH_SNAPSHOT_MS);

  // Node only: never hold a test environment open for a report nobody is
  // waiting on.
  for (const handle of [counterTimer, snapshotTimer, firstSnapshotTimer]) {
    (handle as unknown as { unref?: () => void })?.unref?.();
  }
}

export function teardownTelemetry(): void {
  stopTimers();
  started = false;
}
