/**
 * Tracing utilities for distributed tracing across web client, server, and device.
 */

/**
 * Generate a unique trace ID (UUID v4).
 */
export function generateTraceId(): string {
  return crypto.randomUUID();
}

/**
 * Determine client type based on platform.
 * - 'browser' - web browser
 * - 'embedded_mac' - embedded webview in Mac relay app
 * - 'embedded_ios' - embedded webview in iOS app
 * - 'embedded' - other embedded webview
 */
export function getClientType(): string {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (win.isEmbeddedMac) return 'embedded_mac';
    if (win.isEmbeddedIOS) return 'embedded_ios';
    if (win.isEmbedded) return 'embedded';
  }
  return 'browser';
}

/**
 * Create trace context for a request.
 */
export function createTraceContext(action: string, accessoryId?: string) {
  return {
    traceId: generateTraceId(),
    clientTimestamp: new Date().toISOString(),
    clientType: getClientType(),
    action,
    accessoryId,
  };
}
