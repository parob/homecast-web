/** Open a URL in the system browser.
 *
 * Inside the Mac/iOS app's WKWebView, window.open(_blank) is silently
 * ignored — external links must go through the native `openUrl` bridge.
 */
export function openExternalUrl(url: string): void {
  const w = window as Window & {
    webkit?: {
      messageHandlers?: {
        homecast?: { postMessage: (msg: { action: string; url?: string }) => void };
      };
    };
  };
  if (w.webkit?.messageHandlers?.homecast) {
    w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
