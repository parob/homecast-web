/**
 * Cloud-relay copy that renders from more than one screen.
 *
 * The "signups paused" sentence renders from three places in SetupState (the
 * GetStarted inset, the cloud option card, and RelayOfflineState) and once in
 * Settings → Homes. It has already drifted once: homecast-web#31 rewrote it in
 * OnboardingOverlay and the other four copies kept the old wording, so the same
 * state read two different ways depending on which screen you arrived from.
 *
 * Same rule as the RELAY_OFFLINE_* constants in SetupState.tsx — one copy only.
 */

/** Standalone, where the surrounding UI already says this is about the cloud relay. */
export const CLOUD_SIGNUPS_PAUSED = 'Signups paused while we are at capacity';

/** Prefixed, for the one-line summaries that have to name the relay themselves. */
export const CLOUD_RELAY_SIGNUPS_PAUSED = `Cloud relay · signups paused while we are at capacity`;
