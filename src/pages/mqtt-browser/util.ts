/** True when the page is hosted on `mqtt.*` (cross-subdomain cookie auth). */
export function isMqttDomain(): boolean {
  return location.hostname.includes('mqtt.');
}

/** Homecast API base URL for the current environment. */
export function getApiBase(): string {
  return location.hostname.includes('staging') ? 'https://staging.api.homecast.cloud' : 'https://api.homecast.cloud';
}

/** Read the JWT from either the `hc_token` cookie (mqtt.* domains) or localStorage. */
export function getJWT(): string | null {
  if (isMqttDomain()) {
    const jwt = document.cookie.split('; ').find(c => c.startsWith('hc_token='))?.split('=')[1];
    return jwt ? decodeURIComponent(jwt) : null;
  }
  return localStorage.getItem('homecast-token');
}

/** Build fetch headers for an authenticated GraphQL request, or null if no token. */
export function getAuthHeaders(): Record<string, string> | null {
  const jwt = getJWT();
  return jwt ? { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` } : null;
}
