/**
 * "Don't show me this again", stored so it survives.
 *
 * The first version of the relay-access notice wrote one localStorage key per
 * home — `hc_editrights_dismissed_<home.id>` — which assumes a home's id never
 * varies. It does: sources disagree on case (HomeKit, the relay and the
 * dashboard cache report UUIDs uppercase, the cloud resolves them lowercase),
 * and a home can be re-keyed onto a second UUID when the relay's HomeKit
 * context changes. Either one asks localStorage for a key that was never
 * written, so a notice the user had dismissed came back.
 *
 * So a dismissal records a *set* of tokens for the thing dismissed — the
 * case-folded id and the case-folded name — and the notice stays hidden when
 * any one of them matches. One key per notice type holds the whole set.
 *
 * The list functions are pure; only `readDismissals`/`writeDismissals` touch
 * storage, and they swallow its errors (Safari private mode throws on write).
 */

export interface DismissTarget {
  id?: string | null;
  name?: string | null;
}

/** Keep the stored list bounded — a token set is tiny, but it only ever grows. */
const MAX_TOKENS = 200;

const storageKey = (noticeId: string) => `hc_dismissed_${noticeId}`;

/**
 * Every identity a target may later be recognised by. Empty parts are dropped,
 * so a target with neither id nor name yields no tokens and can never be
 * dismissed — better than minting a token that matches everything.
 */
export function dismissTokens(target: DismissTarget): string[] {
  const tokens: string[] = [];
  const id = target.id?.trim();
  const name = target.name?.trim();
  if (id) tokens.push(`id:${id.toLowerCase()}`);
  if (name) tokens.push(`name:${name.toLowerCase()}`);
  return tokens;
}

export function isDismissed(
  stored: readonly string[] | null | undefined,
  tokens: readonly string[],
): boolean {
  if (!stored || stored.length === 0 || tokens.length === 0) return false;
  const set = new Set(stored);
  return tokens.some(token => set.has(token));
}

/** The stored list with `tokens` added, deduped, newest last, capped. */
export function withDismissal(
  stored: readonly string[] | null | undefined,
  tokens: readonly string[],
): string[] {
  const merged = [...(stored || []), ...tokens];
  const deduped = Array.from(new Set(merged));
  return deduped.slice(-MAX_TOKENS);
}

export function readDismissals(noticeId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(noticeId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeDismissals(noticeId: string, tokens: readonly string[]): void {
  try {
    localStorage.setItem(storageKey(noticeId), JSON.stringify(tokens));
  } catch {
    /* storage unavailable — the notice reappears next session, which is the
       old behaviour rather than a new failure */
  }
}

/**
 * @param legacyKeys older per-target keys written by a previous version, each
 *   holding '1'. Checked so an existing dismissal isn't forgotten on upgrade.
 */
export function isNoticeDismissed(
  noticeId: string,
  target: DismissTarget,
  legacyKeys: readonly string[] = [],
): boolean {
  if (isDismissed(readDismissals(noticeId), dismissTokens(target))) return true;
  try {
    return legacyKeys.some(key => localStorage.getItem(key) === '1');
  } catch {
    return false;
  }
}

export function dismissNotice(noticeId: string, target: DismissTarget): void {
  writeDismissals(noticeId, withDismissal(readDismissals(noticeId), dismissTokens(target)));
}
