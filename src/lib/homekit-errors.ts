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
 * What the missing permission actually blocks. The same HomeKit access control
 * gates scenes and automations alike, but naming the wrong one reads as a
 * non-sequitur — a user told "HomeKit automations can't be changed" after
 * failing to save a *scene* reasonably concludes we've misdiagnosed it.
 */
export type ViewOnlySubject = 'automation' | 'scene' | 'both';

const VIEW_ONLY_SUBJECT_TEXT: Record<ViewOnlySubject, string> = {
  automation: 'HomeKit automations',
  scene: 'HomeKit scenes',
  both: 'HomeKit scenes and automations',
};

/**
 * The self-contained version, for errors surfaced over the API and to MCP
 * agents. Unlike the inline UI notices it keeps the older-OS alias inline —
 * there's no tooltip on an error payload, and a user on an older iOS looking
 * for "Add & Edit Accessories" won't find it under that name.
 */
export function homeViewOnlyMessage(subject: ViewOnlySubject = 'automation'): string {
  return (
    `The relay's Apple ID has view-only access to this home, so ${VIEW_ONLY_SUBJECT_TEXT[subject]} ` +
    'can\'t be changed. In Apple Home → Home Settings, enable "Add & Edit Accessories" ' +
    'for the relay ("Allow Editing" on older iOS and macOS).'
  );
}

/**
 * The automation phrasing, unchanged — this is the constant mirrored in the
 * cloud server's homekit_errors.py, so it stays byte-identical.
 */
export const HOMEKIT_EDIT_PERMISSION_MESSAGE = homeViewOnlyMessage('automation');

/**
 * Who the user has to grant access to, which is not the same person in both
 * setups. A Cloud Relay is a Homecast-run Apple ID the user invited to their
 * home by email; a self-hosted relay is their own Mac. "The relay user" covered
 * both by naming neither, and left cloud users hunting for an entry in Home
 * Settings that reads as a stranger's email address.
 */
export type RelayKind = 'cloud' | 'self-hosted';

const RELAY_KIND_WHO: Record<RelayKind, string> = {
  cloud: 'the Homecast relay',
  'self-hosted': "your relay's Apple ID",
};

/**
 * The fix alone, as a path rather than a sentence.
 *
 * Written out longhand ("In the Apple Home app, open Home Settings, tap the
 * relay user, and enable…") this ran to 25 words and got embedded inside
 * another sentence, producing 40–50 word notices nobody read. A path is
 * scannable and survives being dropped into any surface.
 *
 * Pass `undefined` when the relay kind isn't known yet — it rides a separate
 * payload that can still be loading. That falls back to the original
 * relay-agnostic "the relay user", which is vague but true of both; defaulting
 * to either concrete kind would name the wrong one half the time.
 */
export function homeEditPermissionFix(relayKind?: RelayKind): string {
  const who = relayKind ? RELAY_KIND_WHO[relayKind] : 'the relay user';
  return `Apple Home → Home Settings → ${who} → "Add & Edit Accessories".`;
}

/**
 * The older-OS alias. Genuinely useful, but not worth a parenthetical in every
 * inline notice — attach it as a `title` so it's there on hover without
 * costing a line.
 */
export const HOMEKIT_EDIT_PERMISSION_ALIAS =
  'Called "Allow Editing" on older iOS and macOS versions.';

/**
 * The fix as steps, for the one surface that has room to spell it out — the
 * explainer behind the inline notice. Everywhere else keeps the one-line path
 * from `homeEditPermissionFix`.
 *
 * `relayEmail` is the address the relay actually appears under in Apple Home's
 * People list; when we know it, naming it beats any description of who to look
 * for. Cloud Relay users are hunting for what reads as a stranger's email.
 */
export function homeEditPermissionSteps(relayKind?: RelayKind, relayEmail?: string | null): string[] {
  const who = relayEmail?.trim() || (relayKind ? RELAY_KIND_WHO[relayKind] : 'the relay user');
  return [
    "Open the Apple Home app on a device signed in as this home's owner.",
    'Tap the ⋯ button, then Home Settings.',
    `Under People, tap ${who}.`,
    'Turn on "Add & Edit Accessories".',
  ];
}

/** What Full access adds, and what already works without it. */
export const HOMEKIT_EDIT_PERMISSION_GAIN =
  'Homecast can create, edit and delete HomeKit scenes and automations.';
export const HOMEKIT_EDIT_PERMISSION_WITHOUT =
  'Without it, Homecast can still control accessories, run scenes, and run its own automations — it just can\'t change what Apple Home stores.';

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

/**
 * Translate an error for display; unrelated errors keep their original text.
 *
 * `subject` defaults to 'automation' so every call site that predates scene
 * support keeps its exact wording.
 */
export function translateHomeKitError(error: unknown, subject: ViewOnlySubject = 'automation'): string {
  if (isInsufficientHomeKitPrivileges(error)) return homeViewOnlyMessage(subject);
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.length > 0 ? message : String(error);
}
