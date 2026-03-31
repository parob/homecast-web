/**
 * Dynamic cloud feature loader.
 *
 * Checks if @homecast/cloud is installed. If not, the app runs in
 * Community-only mode. All cloud UI is conditionally rendered based
 * on this module.
 */

type CloudModule = typeof import('@homecast/cloud');

let _cloud: CloudModule | null | undefined = undefined; // undefined = not checked yet

/**
 * Check if cloud features are available (synchronous, after init).
 */
export function hasCloud(): boolean {
  return _cloud != null;
}

/**
 * Get the cloud module (synchronous, after init). Returns null if not available.
 */
export function getCloud(): CloudModule | null {
  return _cloud ?? null;
}

/**
 * Initialize cloud feature detection. Call once at app startup.
 * Tries to import @homecast/cloud — if it fails, cloud features are disabled.
 */
export async function initCloud(): Promise<boolean> {
  if (_cloud !== undefined) return _cloud != null;
  try {
    _cloud = await import('@homecast/cloud');
    console.log('[Homecast] Cloud features loaded');
    return true;
  } catch {
    _cloud = null;
    console.log('[Homecast] Community-only mode (no @homecast/cloud)');
    return false;
  }
}
