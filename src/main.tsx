import { initConsoleCapture } from "./lib/console-capture";
initConsoleCapture();

import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App.tsx";
import "./index.css";

// Initialize native module (includes menu bar bridge for Mac app)
import "./native";

// Initialize cloud features (checks if @homecast/cloud is installed)
import { initCloud } from "./lib/cloud";
initCloud();

// Initialize Community mode local server (handles external WebSocket clients)
import { initLocalServer } from "./server/local-server";
import { initLocalBroadcast } from "./server/local-broadcast";
initLocalServer();
initLocalBroadcast();

// Touch press feedback — JS-based because CSS :active is unreliable in iOS WKWebView
// (isTextInteractionEnabled=false suppresses :active, Tailwind preflight kills tap-highlight)
const PRESSABLE = 'button, a[href], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="option"], [role="switch"]';
let pressedEl: Element | null = null;
document.addEventListener('touchstart', (e) => {
  const target = (e.target as HTMLElement).closest(PRESSABLE);
  if (target && !target.matches(':disabled, [data-disabled]')) {
    pressedEl = target;
    target.classList.add('pressed');
  }
}, { passive: true });
const clearPressed = () => { if (pressedEl) { pressedEl.classList.remove('pressed'); pressedEl = null; } };
document.addEventListener('touchend', clearPressed, { passive: true });
document.addEventListener('touchcancel', clearPressed, { passive: true });

// Detect if running inside Mac app's WKWebView and add class for native-like styling
const w = window as Window & {
  isHomecastMacApp?: boolean;
  webkit?: { messageHandlers?: { homecast?: unknown } };
  isHomecastIOSApp?: boolean;
};
if (w.isHomecastMacApp || (w.webkit?.messageHandlers?.homecast && !w.isHomecastIOSApp)) {
  document.documentElement.classList.add('mac-app');
}
if (w.isHomecastIOSApp) {
  document.documentElement.classList.add('ios-app');
}

window.addEventListener('vite:preloadError', (e) => {
  // Only auto-reload once to avoid infinite loops. If already reloaded, show error instead.
  const key = 'homecast-preload-reload';
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');
    window.location.reload();
  } else {
    sessionStorage.removeItem(key);
    console.error('[Homecast] Failed to load module after reload:', e);
  }
});

try {
  createRoot(document.getElementById("root")!).render(<ErrorBoundary><App /></ErrorBoundary>);
} catch (e) {
  // Fatal error before React could mount — show visible error instead of white screen
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,sans-serif;text-align:center;padding:24px"><div><div style="font-size:36px;margin-bottom:16px;opacity:.5">:(</div><p style="font-size:13px;opacity:.5;margin-bottom:20px">${(e as Error).message || 'Failed to load'}</p><button onclick="location.reload()" style="background:rgba(128,128,128,.1);color:inherit;border:1px solid rgba(128,128,128,.2);border-radius:8px;padding:8px 20px;font-size:14px;cursor:pointer">Reload</button></div></div>`;
  }
}
