/**
 * HomeKit security-system state, shared between the widget and the Actions
 * catalog. Extracted rather than copied — the boolean fallback below is the
 * kind of mapping that silently drifts when it exists twice.
 */

/** HomeKit `security_system_current_state` / `security_system_target_state`. */
export const SECURITY_STATE = {
  STAY_ARM: 0,
  AWAY_ARM: 1,
  NIGHT_ARM: 2,
  DISARMED: 3,
  TRIGGERED: 4,
} as const;

export const SECURITY_STATE_NAMES = ['Stay Arm', 'Away Arm', 'Night Arm', 'Disarmed', 'Triggered'];

/**
 * Normalize a reported state to a HomeKit numeric value.
 *
 * Some devices report boolean-like values instead of the enum, where true
 * means armed — hence the second pair of checks. Ambiguity is resolved in
 * favour of the boolean reading, which is why `'0'` lands on Disarmed rather
 * than Stay Arm; don't "fix" that without a device that proves otherwise.
 */
export function normalizeSecurityState(value: unknown): number {
  if (typeof value === 'number') {
    return value >= 0 && value <= 4 ? value : SECURITY_STATE.DISARMED;
  }
  if (value === true || value === 'true' || value === 1 || value === '1') return SECURITY_STATE.AWAY_ARM;
  if (value === false || value === 'false' || value === 0 || value === '0') return SECURITY_STATE.DISARMED;
  return SECURITY_STATE.DISARMED;
}

/**
 * Armed for the purpose of "should the toggle offer Disarm?".
 *
 * Deliberately broader than the widget's badge logic (`state < 3`, which reads
 * Triggered as not-armed so it can show its own alert styling): a system that
 * is going off is emphatically something you want to be able to disarm.
 */
export function isSecurityArmed(state: number): boolean {
  return state !== SECURITY_STATE.DISARMED;
}
