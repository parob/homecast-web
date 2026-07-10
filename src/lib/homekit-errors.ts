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

export const HOMEKIT_EDIT_PERMISSION_MESSAGE =
  "The relay's Apple ID doesn't have permission to edit this home, so HomeKit " +
  'automations can\'t be created or changed. In the Apple Home app, open Home Settings, ' +
  'tap the relay user, and enable "Add & Edit Accessories" ' +
  '(called "Allow Editing" on older iOS and macOS versions).';

/** The fix instruction alone (for proactive notices where the failure hasn't happened yet). */
export const HOMEKIT_EDIT_PERMISSION_FIX =
  'In the Apple Home app, open Home Settings, tap the relay user, and enable ' +
  '"Add & Edit Accessories" (called "Allow Editing" on older iOS and macOS versions).';

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
