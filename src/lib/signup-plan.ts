/**
 * The plan someone picked on the Pricing page, carried across sign-up.
 *
 * Sign-up can't finish in one page: the account exists only once the email
 * link is clicked, which lands on /verify-email (often in a new tab) and signs
 * them in there. A query parameter would not survive that hop, so the choice
 * is kept in this browser and read by whichever page signs them in —
 * verify-email or login — to send them to checkout for it.
 */

export type PaidPlan = 'standard' | 'cloud';

const KEY = 'homecast-signup-plan';
/** Long enough to find the email tomorrow; short enough not to ambush a later visit. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function parsePlan(value: string | null | undefined): PaidPlan | null {
  return value === 'standard' || value === 'cloud' ? value : null;
}

/** Where a signed-in account goes to buy a plan. */
export function subscribePath(plan: PaidPlan): string {
  return `/subscribe?plan=${plan}`;
}

export function rememberSignupPlan(plan: PaidPlan, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ plan, at: now }));
  } catch { /* storage blocked: they can still pick the plan in the app */ }
}

/**
 * The checkout to continue to, if a plan was picked before signing up.
 * Read-only, so it is safe to call while rendering; the Subscribe page
 * clears it once it has taken them to checkout.
 */
export function signupPlanDestination(now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const { plan, at } = JSON.parse(raw) as { plan?: string; at?: number };
    const parsed = parsePlan(plan);
    if (!parsed || typeof at !== 'number' || now - at > MAX_AGE_MS) return null;
    return subscribePath(parsed);
  } catch {
    return null;
  }
}

export function clearSignupPlan(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
