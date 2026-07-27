/**
 * HomeKit error translation for user-facing surfaces.
 *
 * The relay forwards HomeKit's raw errors (e.g. "Automation creation failed:
 * Insufficient privileges."). The privileges case means the relay Mac's
 * Apple ID lacks edit access in Apple Home — actionable by the user, so we
 * translate it into guidance. Newer relays emit the stable code
 * INSUFFICIENT_HOMEKIT_PRIVILEGES; shipped relays only carry the message
 * text, so detection matches both.
 *
 * Keep the wording in sync with the cloud server's
 * homecast/utils/homekit_errors.py (mirrored constant).
 */

export const INSUFFICIENT_HOMEKIT_PRIVILEGES = 'INSUFFICIENT_HOMEKIT_PRIVILEGES';

/**
 * The self-contained version, for errors surfaced over the API and to MCP
 * agents. Unlike the inline UI notices it keeps the older-OS alias inline —
 * there's no tooltip on an error payload, and a user on an older iOS looking
 * for "Add & Edit Accessories" won't find it under that name.
 */
export const HOMEKIT_EDIT_PERMISSION_MESSAGE =
  "The relay's Apple ID has view-only access to this home, so HomeKit automations " +
  'can\'t be changed. In Apple Home → Home Settings, enable "Add & Edit Accessories" ' +
  'for the relay ("Allow Editing" on older iOS and macOS).';

/**
 * The fix alone, as a path rather than a sentence.
 *
 * Written out longhand ("In the Apple Home app, open Home Settings, tap the
 * relay user, and enable…") this ran to 25 words and got embedded inside
 * another sentence, producing 40–50 word notices nobody read. A path is
 * scannable and survives being dropped into any surface.
 */
export const HOMEKIT_EDIT_PERMISSION_FIX =
  'Apple Home → Home Settings → the relay user → "Add & Edit Accessories".';

/**
 * The older-OS alias. Genuinely useful, but not worth a parenthetical in every
 * inline notice — attach it as a `title` so it's there on hover without
 * costing a line.
 */
export const HOMEKIT_EDIT_PERMISSION_ALIAS =
  'Called "Allow Editing" on older iOS and macOS versions.';

/**
 * How much the relay's Apple ID can do in a home, as one phrase.
 *
 * "Full access" / "View-only" deliberately mirrors Apple Home's own wording,
 * so what the admin panel says matches what the user sees when they go and
 * change it. Previously this was spelled four different ways — including a
 * bare shield icon in the admin panel, which didn't even indicate direction.
 *
 * `isAdmin` is null/undefined on relays older than 1.1.2, which never reported
 * it; that's genuinely unknown rather than restricted, so callers should hide
 * the label entirely rather than guess.
 */
export function homeAccessLabel(isAdmin: boolean | null | undefined): string | null {
  if (isAdmin === true) return 'Full access';
  if (isAdmin === false) return 'View-only';
  return null;
}

/**
 * What the access level means, in as few words as it can be said. Used inline
 * next to the label and as the `title` on the compact badges, so it has to
 * stay short enough to read at a glance.
 */
export function homeAccessHint(isAdmin: boolean | null | undefined): string | null {
  if (isAdmin === true) return 'Can control devices and manage HomeKit automations.';
  if (isAdmin === false) return 'Can control devices. HomeKit automations are read-only.';
  return null;
}

/**
 * Detect the HomeKit edit-permission failure on any error shape we see:
 * HomecastError / native-bridge errors (carry a `code`), ApolloError /
 * plain Errors (message text only).
 */
export function isInsufficientHomeKitPrivileges(error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: unknown })?.code;
  if (code === INSUFFICIENT_HOMEKIT_PRIVILEGES) return true;
  const text = String((error as { message?: unknown })?.message ?? error);
  return text.includes(INSUFFICIENT_HOMEKIT_PRIVILEGES) || /insufficient privileges/i.test(text);
}

/** Translate an error for display; unrelated errors keep their original text. */
export function translateHomeKitError(error: unknown): string {
  if (isInsufficientHomeKitPrivileges(error)) return HOMEKIT_EDIT_PERMISSION_MESSAGE;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.length > 0 ? message : String(error);
}
