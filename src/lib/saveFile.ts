import { checkIsInMacApp } from '@/lib/platform';
import { HomeKit } from '@/native/homekit-bridge';

/**
 * Save text as a file from anywhere the web app runs.
 *
 * The browser trick — a blob URL on an `<a download>` — does nothing in the
 * Mac app's WKWebView: WebKit only performs downloads when the host app
 * implements WKDownloadDelegate, so the click silently no-ops (this is why
 * Export CSV appeared broken there). Order of preference:
 *
 *   1. Native `file.save` bridge (Mac/iOS app, once running a build that
 *      has it) — a real export sheet, a real file.
 *   2. Anchor download — browsers, Tauri, and any WKWebView build that
 *      grows download support later.
 *   3. Clipboard — always available on a secure origin, so the data is
 *      never trapped: the caller tells the user it was copied.
 */
export type SaveOutcome = 'saved' | 'downloaded' | 'copied' | 'failed';

export async function saveTextFile(
  filename: string,
  contents: string,
  mimeType = 'text/plain',
): Promise<SaveOutcome> {
  // 1. Native save sheet.
  try {
    if (await HomeKit.canSaveFile()) {
      await HomeKit.saveFile(filename, contents, mimeType);
      return 'saved';
    }
  } catch {
    // Fall through — an older app build, or the user cancelled the sheet.
  }

  // 2. Anchor download. Skipped inside the Mac app, where it fails silently
  // and would leave the user with no feedback at all.
  if (!checkIsInMacApp()) {
    try {
      const blob = new Blob([contents], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return 'downloaded';
    } catch {
      // Fall through to the clipboard.
    }
  }

  // 3. Clipboard — the data reaches the user one way or another.
  try {
    await navigator.clipboard.writeText(contents);
    return 'copied';
  } catch {
    return 'failed';
  }
}
