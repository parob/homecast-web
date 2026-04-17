export type ConnectionDiagnosis = 'offline' | 'backend-down' | 'unknown';

export async function diagnoseConnection(): Promise<ConnectionDiagnosis> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'offline';
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(
      `${window.location.origin}/version.json?t=${Date.now()}`,
      { cache: 'no-store', signal: controller.signal }
    );
    clearTimeout(timer);
    return resp.ok ? 'backend-down' : 'unknown';
  } catch {
    return 'offline';
  }
}
