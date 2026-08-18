/**
 * The website inside the web app.
 *
 * These six paths render the marketing site — the landing page, the legal
 * copy, MarketingHeader/MarketingFooter — rather than any part of the product.
 * Two places have to agree on that list: the staging badge, which stays off the
 * public site, and the route table, which collapses them to the dashboard
 * inside the native app (see App.tsx).
 *
 * It is a leaf on purpose — no React, no Apollo, no `window` — so the gate is
 * testable without a DOM.
 *
 * `/delete-account` is deliberately absent. It wears the same chrome, but
 * `resetAndUninstall` is Community-only (AccountSection.tsx, Dashboard.tsx both
 * gate on isCommunity), so for a cloud account this page is the only deletion
 * route the product has — it is what Apple 5.1.1(v) and Google's data-deletion
 * URL point at. It stays reachable everywhere.
 *
 * `/features` is absent too: it is an alias that only ever redirects, so it has
 * no page of its own to suppress a badge on or to collapse.
 */

export const MARKETING_PATHS: readonly string[] = [
  '/', '/how-it-works', '/pricing', '/terms', '/privacy', '/cookies',
];

/** Is this pathname a page of the website rather than a screen of the app? */
export function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATHS.includes(pathname);
}
