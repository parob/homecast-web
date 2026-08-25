/**
 * Native capture, where a native shell provides it.
 *
 * The web layer can screenshot the DOM and, on desktop, record the screen via
 * getDisplayMedia. Neither works in iOS WKWebView: getDisplayMedia is absent,
 * and a DOM screenshot cannot see native surfaces. The Swift shell fills both
 * gaps with a real screen capture and a ReplayKit recording, and reports the
 * shake gesture iOS already detects for us.
 *
 * Mirrors the calling convention of homekit-bridge: a capability flag the shell
 * sets on window, and `window.homecastReport.call()` returning a promise that
 * settles when native answers.
 */

export type NativeCaptureKind = 'screenshot' | 'recording';

interface ReportBridge {
  call<T>(method: string, payload?: Record<string, unknown>): Promise<T>;
  onShake?(handler: () => void): () => void;
}

type ReportWindow = Window & {
  homecastReport?: ReportBridge;
  isNativeCaptureCapable?: boolean;
  isNativeRecordingCapable?: boolean;
};

/** A native shell that can take a real screen capture. */
export function isNativeCaptureCapable(): boolean {
  return (window as ReportWindow).isNativeCaptureCapable === true;
}

/**
 * A native shell that can record the screen.
 *
 * Deliberately separate from capture: iOS can screenshot but only records via
 * ReplayKit, and a shell may ship one before the other.
 */
export function isNativeRecordingCapable(): boolean {
  return (window as ReportWindow).isNativeRecordingCapable === true;
}

/**
 * A native call is unbounded unless we bound it — the same trap documented at
 * length in homekit-bridge. A wedged capture must not leave the report sheet
 * spinning forever, so give up and fall back to what the web can do.
 */
const CAPTURE_TIMEOUT_MS = 15_000;
const RECORDING_STOP_TIMEOUT_MS = 30_000;

async function call<T>(method: string, payload?: Record<string, unknown>, timeoutMs = CAPTURE_TIMEOUT_MS): Promise<T> {
  const bridge = (window as ReportWindow).homecastReport;
  if (!bridge) throw new Error('NATIVE_BRIDGE_UNAVAILABLE');

  return await Promise.race([
    bridge.call<T>(method, payload),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`NATIVE_TIMEOUT:${method}`)), timeoutMs),
    ),
  ]);
}

/** Base64 PNG of the current screen, from the native shell. */
export async function nativeScreenshot(): Promise<string> {
  const result = await call<{ data: string }>('captureScreenshot');
  return result.data;
}

export async function nativeStartRecording(): Promise<void> {
  await call<void>('startRecording');
}

/** Base64 MP4 of the recording just stopped. */
export async function nativeStopRecording(): Promise<{ data: string; mimeType: string }> {
  return await call<{ data: string; mimeType: string }>(
    'stopRecording', undefined, RECORDING_STOP_TIMEOUT_MS,
  );
}

/**
 * Subscribe to the shell's shake gesture.
 *
 * iOS raises this itself (motionEnded), which is both more reliable and better
 * behaved than sampling devicemotion in JavaScript — no permission prompt, and
 * it matches what the user already expects a shake to do on that platform.
 * Returns a no-op unsubscribe when the shell does not provide it.
 */
export function onNativeShake(handler: () => void): () => void {
  const bridge = (window as ReportWindow).homecastReport;
  if (!bridge?.onShake) return () => {};
  return bridge.onShake(handler);
}
