/**
 * Capturing what the user is looking at.
 *
 * Three routes, and which one is available depends entirely on the shell:
 *
 * - **Native.** A real screen capture, and a ReplayKit recording on iOS. The
 *   only route that can see native surfaces, and the only recording route that
 *   works on a phone at all.
 * - **getDisplayMedia.** Desktop browsers and Tauri. Shows a picker, so the
 *   user chooses what to share — which is also why it cannot be silent.
 * - **DOM rasterisation.** The universal fallback for a still. It draws what
 *   the page describes, not what the compositor shows, so a native overlay or
 *   a cross-origin iframe will be missing from it. Good enough to show which
 *   screen someone was on and what it said.
 *
 * Nothing here throws at the caller: a capture that fails returns null and the
 * report goes without it. Losing the report because the screenshot failed would
 * be the wrong trade.
 */

import {
  isNativeCaptureCapable,
  isNativeRecordingCapable,
  nativeScreenshot,
  nativeStartRecording,
  nativeStopRecording,
} from '@/native/report-bridge';

/**
 * Largest single attachment the upload path can carry.
 *
 * Bounded by the issue reporter running on Cloud Run, which caps an HTTP/1
 * request at 32 MiB, and by this file being sent base64-encoded inside a JSON
 * body — roughly 1.37x its raw size. 20 MiB raw lands near 27 MiB on the wire,
 * which leaves room for the rest of the request.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface CapturedMedia {
  blob: Blob;
  mimeType: string;
  filename: string;
  /** Object URL for previewing in the sheet. Revoke when done. */
  previewUrl: string;
}

function fromBase64(data: string, mimeType: string): Blob {
  const clean = data.includes(',') ? data.split(',')[1] : data;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function wrap(blob: Blob, filename: string): CapturedMedia {
  return {
    blob,
    mimeType: blob.type,
    filename,
    previewUrl: URL.createObjectURL(blob),
  };
}

/** Whether a still can be captured at all here. Always true in practice. */
export function canScreenshot(): boolean {
  return isNativeCaptureCapable() || typeof document !== 'undefined';
}

/** Whether the screen can be recorded here — false in iOS WKWebView. */
export function canRecord(): boolean {
  return (
    isNativeRecordingCapable() ||
    (typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined')
  );
}

export async function captureScreenshot(): Promise<CapturedMedia | null> {
  if (isNativeCaptureCapable()) {
    try {
      const data = await nativeScreenshot();
      return wrap(fromBase64(data, 'image/png'), 'screenshot.png');
    } catch (error) {
      // Fall through to the DOM route rather than giving up — a worse
      // screenshot beats none.
      console.warn('[report] native screenshot failed, falling back', error);
    }
  }

  try {
    // Loaded on demand: this is a heavy dependency used by one rarely-opened
    // sheet, and bundling it into the main chunk would cost every page load.
    const { toBlob } = await import('html-to-image');
    const blob = await toBlob(document.body, {
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      cacheBust: true,
      // Fonts are already loaded; re-embedding them can take seconds on a
      // large page and adds nothing to a screenshot of it.
      skipFonts: true,
      filter: (node) =>
        !(node instanceof HTMLElement && node.dataset.reportExclude === 'true'),
    });
    return blob ? wrap(blob, 'screenshot.png') : null;
  } catch (error) {
    console.warn('[report] screenshot failed', error);
    return null;
  }
}

/**
 * A screen recording in progress.
 *
 * `stop` always settles: a recorder that never fires onstop would otherwise
 * leave the sheet waiting on a promise that never resolves.
 */
export interface ActiveRecording {
  stop: () => Promise<CapturedMedia | null>;
  cancel: () => void;
}

/**
 * Ceiling on a single recording.
 *
 * Long enough to demonstrate a real problem, short enough that the upload stays
 * sane on a phone connection. Multiple recordings are allowed instead, which
 * also tends to produce clearer evidence than one long take.
 */
export const MAX_RECORDING_MS = 60_000;

export async function startRecording(
  onAutoStop?: () => void,
): Promise<ActiveRecording | null> {
  if (isNativeRecordingCapable()) {
    try {
      await nativeStartRecording();
      return {
        stop: async () => {
          try {
            const { data, mimeType } = await nativeStopRecording();
            return wrap(fromBase64(data, mimeType), 'recording.mp4');
          } catch (error) {
            console.warn('[report] native recording failed', error);
            return null;
          }
        },
        cancel: () => {
          void nativeStopRecording().catch(() => {});
        },
      };
    } catch (error) {
      console.warn('[report] could not start native recording', error);
      return null;
    }
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: false,
    });
  } catch {
    // Includes the user dismissing the picker, which is not an error.
    return null;
  }

  const mimeType = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';

  // A fixed bitrate, not the browser's default. The recording has to survive a
  // base64 round trip through a JSON body into a service that caps a request at
  // 32 MiB, and base64 costs ~1.37x — an unconstrained 60s capture can exceed
  // that on its own. 1.2 Mbps puts a minute around 9 MB and is ample for
  // showing what a UI did.
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 1_200_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(1_000);

  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

  let settled = false;
  const finish = () =>
    new Promise<CapturedMedia | null>((resolve) => {
      if (settled) return resolve(null);
      settled = true;
      const done = () => {
        stopTracks();
        resolve(
          chunks.length
            ? wrap(new Blob(chunks, { type: mimeType }),
                   mimeType.startsWith('video/mp4') ? 'recording.mp4' : 'recording.webm')
            : null,
        );
      };
      recorder.onstop = done;
      if (recorder.state === 'inactive') done();
      else recorder.stop();
    });

  // The user can end sharing from the browser's own bar; treat that as stop.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (!settled) onAutoStop?.();
  });

  // A recording nobody stops is a huge upload nobody wanted.
  const timer = setTimeout(() => {
    if (!settled) onAutoStop?.();
  }, MAX_RECORDING_MS);

  return {
    stop: async () => {
      clearTimeout(timer);
      return await finish();
    },
    cancel: () => {
      clearTimeout(timer);
      settled = true;
      stopTracks();
    },
  };
}
