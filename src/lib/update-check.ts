/**
 * Noticing that a deploy has landed — the decisions, with nothing attached.
 *
 * A merge to main reaches production with no human step, so a tab that has
 * been open since this morning is running code that no longer exists on the
 * host. Until now the app only found that out by *failing*: the first lazy
 * import after a deploy asks for a renamed chunk, and lib/stale-bundle.ts
 * turns the wreckage into a reload. That is a recovery, not an update — a
 * session that never happens to lazy-load anything sits on the old bundle
 * indefinitely, missing every fix that shipped in between.
 *
 * This module decides *whether* a served build is a different one and whether
 * now is a decent moment to take it. The timers, the fetch, the indicator and
 * the reload live in update-check-controller.ts, which is why this one can be
 * unit-tested without a window.
 *
 * ── What identifies a build ───────────────────────────────────────────────
 *
 * /version.json, emitted by versionPlugin in vite.config.ts. Three properties
 * make it the right thing to ask, and none of them are incidental:
 *
 *   - `deployedAt` is stamped at build time, so it differs on every deploy.
 *     `version` does not: it is GITHUB_SHA of *homecast-cloud*, the repo the
 *     deploy workflow runs in, so a web-only change leaves it byte-identical.
 *     That is the same trap that once kept sw.js from ever reinstalling.
 *   - Firebase serves it `Cache-Control: no-cache`, so the answer is live.
 *   - The service worker deliberately does not touch it ("version.json in
 *     particular has to stay live: it's how a deploy is verified").
 *
 * The build we are *running* comes from import.meta.env.VITE_DEPLOY_TIME,
 * baked in from the same constant in the same build. Taking the baseline from
 * the first fetch instead would be wrong in exactly the case worth catching:
 * the worker serves navigations cache-first, so the classic stale session is
 * one whose shell is a build behind while the served version.json is already
 * the new one. Comparing served-against-served would call that up to date.
 */

/** What /version.json says, as far as we're willing to trust it. */
export interface BuildStamp {
  version?: string;
  deployedAt?: string;
}

/**
 * Read a build stamp out of whatever /version.json returned.
 *
 * Anything that isn't an object with at least one usable string is null, not a
 * partial stamp: a malformed answer must read as "no information", never as a
 * build that differs from ours.
 */
export function parseBuildStamp(body: unknown): BuildStamp | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const version = typeof raw.version === 'string' && raw.version ? raw.version : undefined;
  const deployedAt =
    typeof raw.deployedAt === 'string' && raw.deployedAt ? raw.deployedAt : undefined;
  if (!version && !deployedAt) return null;
  return { version, deployedAt };
}

/**
 * Is the host serving a different build than the one running here?
 *
 * Different, not newer. A rollback is a deploy too, and a tab left on the
 * version that was just withdrawn is exactly as wrong as one left behind.
 *
 * `deployedAt` decides it whenever both sides carry one. `version` is only
 * consulted when neither does — it is homecast-cloud's commit, so it moves
 * without the web app and stands still while the web app changes, and it is
 * here solely so a build predating VITE_DEPLOY_TIME can still say something.
 * 'dev' is never a build anyone deployed.
 */
export function isNewBuild(running: BuildStamp, served: BuildStamp | null): boolean {
  if (!served) return false;
  if (running.deployedAt && served.deployedAt) return served.deployedAt !== running.deployedAt;
  if (running.deployedAt || served.deployedAt) return false;
  if (!running.version || !served.version) return false;
  if (running.version === 'dev' || served.version === 'dev') return false;
  return served.version !== running.version;
}

/** The token a build is known by: what the reload guard stores and lands on. */
export function buildToken(stamp: BuildStamp): string {
  return stamp.deployedAt || stamp.version || '';
}

/**
 * The minimal shape of a document this needs, so the decision can be tested
 * without a DOM.
 */
export interface DeferrableDocument {
  querySelector(selectors: string): unknown;
  activeElement: {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?(name: string): string | null;
  } | null;
}

/** Anything Radix opens on top of the app: taking it away mid-use is rude. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const TEXT_INPUTS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Is now a bad moment to reload?
 *
 * Not a permission system — the update is taken as soon as this goes false, at
 * the next re-check. It only avoids the two cases where an automatic reload
 * destroys work the user can see: a dialog they are part-way through, and text
 * they are part-way through typing.
 */
export function shouldDeferReload(doc: DeferrableDocument): boolean {
  if (doc.querySelector(OVERLAY_SELECTOR)) return true;
  const el = doc.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName && TEXT_INPUTS.has(el.tagName)) return true;
  return el.getAttribute?.('role') === 'textbox';
}

/** Everything the eligibility decision depends on, handed in rather than read. */
export interface UpdateCheckEnvironment {
  dev: boolean;
  isCommunity: boolean;
  isRelayMac: boolean;
  running: BuildStamp;
}

/**
 * Where this runs at all.
 *
 * Community mode is served from the Mac app's own Resources — that bundle
 * cannot change without the app restarting, which reloads the WebView anyway.
 *
 * The relay Mac is excluded for the reason lib/service-worker.ts excludes it,
 * pointed the other way: relay code ships by deploying the web app, so this is
 * the one place an automatic update would be worth the most — and also the one
 * place a reload costs something real, dropping the relay socket and
 * restarting the automation engine under whatever it was mid-way through.
 * That trade is a decision to make deliberately, not a default to inherit.
 *
 * And a build with no stamp of its own can never establish that a *different*
 * one is being served, so it doesn't ask.
 */
export function shouldCheckForUpdates(env: UpdateCheckEnvironment): boolean {
  if (env.dev) return false;
  if (env.isCommunity) return false;
  if (env.isRelayMac) return false;
  return !!buildToken(env.running);
}

/**
 * What to do with the reload guard on boot.
 *
 * The guard is the token we last reloaded *towards*. Landing on it means the
 * update took, and the guard is cleared so the next deploy of this session
 * gets its own reload. Booting on anything else after a guarded reload means
 * something in the chain is lying — a worker that would not let go, a host
 * serving two answers — and the only safe move is to stop for the session
 * rather than reload in a circle. The stale-bundle recovery still stands.
 */
export function guardVerdict(
  guard: string | null,
  running: BuildStamp
): 'unguarded' | 'landed' | 'stuck' {
  if (!guard) return 'unguarded';
  return guard === buildToken(running) ? 'landed' : 'stuck';
}
