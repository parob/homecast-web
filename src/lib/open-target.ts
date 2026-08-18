/**
 * Where /open sends you.
 *
 * /open is a doormat, not a page. Safari draws its "Open in the Homecast app"
 * banner on whatever the app claims, and that banner is chrome inside the
 * layout viewport — it followed people around the site and clipped the
 * wallpaper behind it. So the AASA claims this one path and nothing else:
 * emails point here, tapping one still opens the app, and every page anyone
 * actually reads claims nothing and gets no banner.
 *
 * In a browser — no app installed, or a desktop — the route just forwards to
 * the real destination, which is what `?to=` carries.
 *
 * Pure on purpose: the redirect target arrives in a URL a stranger can send, so
 * the validation is the interesting part and it is testable without a DOM.
 */

/** Where an /open with no usable `to` goes. */
export const DEFAULT_OPEN_TARGET = '/portal';

/**
 * Resolve `?to=` into a safe same-site path.
 *
 * Anything that could leave the site falls back to the dashboard rather than
 * being followed. This is an open-redirect guard: the link goes out by email,
 * so "it came from us" is not something we get to assume on the way back in.
 */
export function resolveOpenTarget(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_OPEN_TARGET;

  const value = raw.trim();
  if (value !== raw) return DEFAULT_OPEN_TARGET;            // padded — not something we emitted
  if (!value.startsWith('/')) return DEFAULT_OPEN_TARGET;   // relative, or an absolute URL
  if (value.startsWith('//')) return DEFAULT_OPEN_TARGET;   // protocol-relative — another host
  if (value.includes('\\')) return DEFAULT_OPEN_TARGET;     // backslashes normalise to / in some engines
  if (value.includes('://')) return DEFAULT_OPEN_TARGET;    // embedded scheme
  // Control characters can smuggle a newline into whatever consumes this.
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_OPEN_TARGET;

  return value;
}
