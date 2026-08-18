/**
 * Which writes are still travelling, so a tile can admit it.
 *
 * Homecast repaints before it knows: a toggle writes the new value into the
 * cache and *then* sends `characteristic.set`. That optimism is what makes the
 * app feel local even over the cloud, but it leaves a tile that has moved
 * looking identical whether the relay confirmed in 40ms or is still trying at
 * four seconds. This registry is the missing half — it remembers which writes
 * have not come back, so a widget can draw a ring on its icon.
 *
 * The confirmation signal is the request promise settling, NOT the WebSocket
 * echo. The relay performs the HomeKit write and only then returns
 * (`relay/local-handler.ts`, `characteristic.set`), so a resolved promise
 * genuinely means the relay did it. The echo is the same event on a different
 * channel — buffered 100ms in WebSocketContext, and entitled never to arrive.
 * A promise always settles.
 *
 * Deliberately separate from `PendingUpdatesTracker` in `useHomeKitData.ts`,
 * which looks like it already does this and does not: it is non-reactive, its
 * entry vanishes on a matching echo *or* on a 5s expiry with no way to tell
 * which, and it is keyed per characteristic — so one gesture writing `hue` then
 * `saturation` would be two of everything. That tracker filters stale server
 * updates; this one answers "is it there yet".
 *
 * React-free on purpose, so it tests with fake timers and nothing else. The
 * binding is `hooks/usePendingWrite.ts`.
 */

/**
 * How long a burst must run before the ring appears.
 *
 * A LAN write lands in well under this, so a healthy home never sees a ring at
 * all — which is the point. The indicator is for when something is actually
 * wrong, and one that fires on every tap is just jitter.
 */
export const SHOW_DELAY_MS = 1000;

/**
 * Once shown, the shortest time the ring stays up.
 *
 * Without it a write settling at 1.02s paints a ring for 20ms, which reads as a
 * glitch rather than as feedback.
 */
export const MIN_VISIBLE_MS = 500;

/**
 * How long a key must be quiet before its burst is considered over.
 *
 * This is the load-bearing constant, and it is derived rather than picked.
 * `VerticalSlider` commits on a 250ms leading-edge throttle, and a local write
 * settles in tens of milliseconds — so during a brightness drag the in-flight
 * count is *zero* for roughly 190ms out of every 250ms. Treating each of those
 * gaps as the end of a burst would cancel and re-arm the show timer forever,
 * and a dragged slider would never ring at all.
 *
 * 400ms clears the widest gap a drag can produce (the full throttle window,
 * when latency is nil) with margin to spare.
 */
export const IDLE_GRACE_MS = 400;

/**
 * How long one burst may hold the ring before we stop believing it.
 *
 * Matched to `REQUEST_TIMEOUT` in `server/websocket.ts` (30s), so a legitimately
 * slow write keeps its ring right up to the moment the transport gives up and
 * the rejection toast fires. Cutting it shorter would leave a silent gap where
 * the ring has gone but nothing has been reported yet.
 */
export const MAX_VISIBLE_MS = 30000;

type Timer = ReturnType<typeof setTimeout>;

interface Entry {
  /**
   * How many writes are in flight. A count, not a flag: one gesture can write
   * several characteristics (hue then saturation) and must show one ring.
   */
  count: number;
  /** When the current burst opened, or null when no burst is open. */
  burstStartedAt: number | null;
  visible: boolean;
  shownAt: number;
  showTimer: Timer | null;
  idleTimer: Timer | null;
  hideTimer: Timer | null;
  capTimer: Timer | null;
  /**
   * Per key, not one global set. A hundred tiles are mounted on a dashboard and
   * a drag commits four times a second; a global emit would wake every one of
   * them to ask a question only one of them cares about.
   */
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

/** The registry key for one accessory. */
export const accessoryKey = (id: string): string => `acc:${id}`;

/** The registry key for one service group. */
export const groupKey = (id: string): string => `group:${id}`;

/**
 * A whole home action, so its own card can show the ring too.
 *
 * Not an accessory: an Action writes many of them at once, and the card is what
 * the user is looking at when they press it. Without this an "All lights" press
 * puts rings on forty tiles that may not even be on screen, and leaves the
 * control that was actually pressed showing nothing at all.
 */
export const actionKey = (id: string): string => `action:${id}`;

function ensure(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      count: 0,
      burstStartedAt: null,
      visible: false,
      shownAt: 0,
      showTimer: null,
      idleTimer: null,
      hideTimer: null,
      capTimer: null,
      listeners: new Set(),
    };
    entries.set(key, entry);
  }
  return entry;
}

function notify(entry: Entry): void {
  for (const listener of entry.listeners) listener();
}

/**
 * Drop an entry that has nothing left to say.
 *
 * Never while it still has listeners: a later `begin` would build a *different*
 * entry object with an empty listener set, and the mounted tile would go on
 * subscribed to an orphan, silently never updating again.
 */
function reap(key: string, entry: Entry): void {
  if (
    entry.count === 0 &&
    !entry.visible &&
    entry.burstStartedAt === null &&
    !entry.showTimer && !entry.idleTimer && !entry.hideTimer && !entry.capTimer &&
    entry.listeners.size === 0
  ) {
    entries.delete(key);
  }
}

function show(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.showTimer = null;
  entry.visible = true;
  entry.shownAt = Date.now();
  entry.capTimer = setTimeout(() => abandon(key), MAX_VISIBLE_MS);
  notify(entry);
}

function hide(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.hideTimer) { clearTimeout(entry.hideTimer); entry.hideTimer = null; }
  if (entry.capTimer) { clearTimeout(entry.capTimer); entry.capTimer = null; }
  if (entry.visible) {
    entry.visible = false;
    notify(entry);
  }
  reap(key, entry);
}

/**
 * The burst has outlived the transport's own timeout, so its promise is never
 * settling. Reset to idle rather than spin on — which also means the next write
 * to this key starts from a clean count instead of inheriting a phantom one. A
 * late release from the abandoned write finds nothing to decrement.
 */
function abandon(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.showTimer) { clearTimeout(entry.showTimer); entry.showTimer = null; }
  if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
  if (entry.hideTimer) { clearTimeout(entry.hideTimer); entry.hideTimer = null; }
  if (entry.capTimer) { clearTimeout(entry.capTimer); entry.capTimer = null; }
  entry.count = 0;
  entry.burstStartedAt = null;
  hide(key);
}

/** The burst really is over — nothing new arrived during the grace period. */
function closeBurst(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.idleTimer = null;
  if (entry.count > 0) return; // a write slipped in as the timer fired

  entry.burstStartedAt = null;

  if (entry.showTimer) {
    // Settled before the delay elapsed: the write was quick, the ring never
    // existed, and it must not now appear.
    clearTimeout(entry.showTimer);
    entry.showTimer = null;
  }
  if (!entry.visible) {
    reap(key, entry);
    return;
  }
  const remaining = MIN_VISIBLE_MS - (Date.now() - entry.shownAt);
  if (remaining <= 0) {
    hide(key);
  } else {
    entry.hideTimer = setTimeout(() => hide(key), remaining);
  }
}

function begin(key: string): void {
  const entry = ensure(key);
  entry.count++;

  // Any new write reopens the burst, whether it arrived during the idle grace
  // or during the minimum-visible hold.
  if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
  if (entry.hideTimer) { clearTimeout(entry.hideTimer); entry.hideTimer = null; }

  if (entry.burstStartedAt === null) {
    entry.burstStartedAt = Date.now();
    if (!entry.visible && !entry.showTimer) {
      entry.showTimer = setTimeout(() => show(key), SHOW_DELAY_MS);
    }
  }
}

function end(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  // Guarded so a double release cannot drive the count negative and pin a ring.
  entry.count = Math.max(0, entry.count - 1);
  if (entry.count > 0) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => closeBurst(key), IDLE_GRACE_MS);
}

/**
 * Register a write against one or more keys for as long as it is in flight.
 *
 * Pass the group key *and* every member's accessory key for a group write, so
 * an expanded group's member tiles ring alongside the group's own.
 *
 * Returns the caller's own promise, untouched. Deliberately not
 * `promise.finally(release)`: that returns a *new* promise which re-rejects, so
 * any call site that does not await the tracked result would gain an unhandled
 * rejection it never had before. The release rides a handled side branch
 * instead, leaving the caller's revert-and-toast handling byte-identical.
 */
export function trackWrite<T>(keys: string | string[], promise: Promise<T>): Promise<T> {
  const list = typeof keys === 'string' ? [keys] : keys;
  for (const key of list) begin(key);
  const release = () => { for (const key of list) end(key); };
  promise.then(release, release);
  return promise;
}

/** Whether the ring should currently be drawn for this key. Reactive. */
export function isRingVisible(key: string): boolean {
  return entries.get(key)?.visible ?? false;
}

/**
 * Whether a write is in flight right now, with no delay applied.
 *
 * The truth, as opposed to what the ring is yet willing to say about it — for a
 * caller that needs to act rather than to draw. NOT reactive: listeners fire on
 * ring transitions only, since every tile is memoized and re-rendering the grid
 * on each write begin and end would cost more than it tells anyone.
 */
export function isWriting(key: string): boolean {
  return (entries.get(key)?.count ?? 0) > 0;
}

/** Subscribe to ring transitions for one key. Returns the unsubscribe. */
export function subscribeToKey(key: string, listener: () => void): () => void {
  const entry = ensure(key);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    reap(key, entry);
  };
}

/**
 * Forget everything. Tests only — the map is module state, so one test leaving a
 * write pending would leak a ring into the next.
 */
export function __resetPendingWrites(): void {
  for (const [key, entry] of entries) {
    if (entry.showTimer) clearTimeout(entry.showTimer);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.hideTimer) clearTimeout(entry.hideTimer);
    if (entry.capTimer) clearTimeout(entry.capTimer);
    entries.delete(key);
  }
}
