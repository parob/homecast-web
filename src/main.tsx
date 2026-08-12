import { initConsoleCapture } from "./lib/console-capture";
initConsoleCapture();

import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App.tsx";
import "./index.css";
import { markBoot } from "./lib/boot-timing";

markBoot("module");
import { browserLogger } from "./lib/browser-logger";
import { config } from "./lib/config";

// Install client-side log capture + ship WARN/ERROR to the server so they
// land in Cloud Logging alongside server events (correlated by user_id,
// trace_id where available). Community mode has no cloud endpoint so
// shipping is disabled there; the local ring buffer still works.
browserLogger.install(
  config.isCommunity
    ? undefined
    : {
        source: "web",
        url: () => `${config.apiUrl}/internal/logs`,
        token: () => {
          try {
            return localStorage.getItem("homecast-token");
          } catch {
            return null;
          }
        },
      }
);

// Web Vitals — LCP / INP / CLS reported once per metric per page to
// /internal/logs with source=web-vitals. Skipped in Community mode (no
// cloud endpoint). Imported lazily so it doesn't block initial paint.
if (!config.isCommunity) {
  import("web-vitals")
    .then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
      const report = (name: string) =>
        (metric: { name: string; value: number; id: string; rating?: string }) => {
          try {
            browserLogger.logInfo(
              `web-vital:${name}=${metric.value.toFixed(0)}`,
              { name: metric.name, value: metric.value, id: metric.id, rating: metric.rating ?? "unknown", vital: true }
            );
          } catch { /* noop */ }
        };
      onLCP(report("LCP"));
      onINP(report("INP"));
      onCLS(report("CLS"));
      onFCP(report("FCP"));
      onTTFB(report("TTFB"));
    })
    .catch(() => { /* web-vitals failed to load — not critical */ });
}

// Initialize native module (includes menu bar bridge for Mac app)
import "./native";

// Initialize cloud features (checks if @homecast/cloud is installed)
// Must complete before React renders so getCloud() returns the correct value.
import { initCloud } from "./lib/cloud";

// Initialize Community mode local server (handles external WebSocket clients).
//
// Imported dynamically and only in Community mode. Each of these bails on
// `!isCommunity` at the top of the function, but a *static* import still drags
// the whole tree behind them — local-graphql, local-db, local-auth, local-rest,
// the webhook and history engines — into the entry chunk for every cloud
// browser user, who can never run a local server.
//
// The extra tick this costs on the relay Mac is already tolerated by design:
// LocalHTTPServer answers 503 until the bridge is up, and AuthContext retries
// precisely because "the bridge may still be initializing".
if (config.isCommunity) {
  void Promise.all([
    import("./server/local-server").then(m => m.initLocalServer()),
    import("./server/local-broadcast").then(m => m.initLocalBroadcast()),
    import("./server/local-webhooks").then(m => m.initWebhooks()),
    import("./server/local-history").then(m => m.initLocalHistory()),
  ]).catch(err => console.error("[Homecast] Local server init failed:", err));
}

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
  // A deploy replaced the hashed chunks under a running session — reload to
  // pick up the new bundle. Only once per guard window to avoid loops; the
  // guard clears after the reloaded app has run stably (below), so each
  // future deploy gets its own reload rather than surfacing a raw error.
  const key = 'homecast-preload-reload';
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');
    window.location.reload();
  } else {
    console.error('[Homecast] Failed to load module after reload:', e);
  }
});
window.setTimeout(() => sessionStorage.removeItem('homecast-preload-reload'), 15_000);

// Race cloud init against a short timeout: if the chunk fetch is slow or fails,
// don't keep the user on the splash screen forever. Components that need cloud
// features can re-check via getCloud() once the import resolves.
let mounted = false;
const mount = () => {
  if (mounted) return;
  mounted = true;
  markBoot("mount");
  try {
    createRoot(document.getElementById("root")!).render(<ErrorBoundary><App /></ErrorBoundary>);
  } catch (e) {
    const root = document.getElementById("root");
    if (root) {
      root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,sans-serif;text-align:center;padding:24px"><div><div style="font-size:36px;margin-bottom:16px;opacity:.5">:(</div><p style="font-size:13px;opacity:.5;margin-bottom:20px">${(e as Error).message || 'Failed to load'}</p><button onclick="location.reload()" style="background:rgba(128,128,128,.1);color:inherit;border:1px solid rgba(128,128,128,.2);border-radius:8px;padding:8px 20px;font-size:14px;cursor:pointer">Reload</button></div></div>`;
    }
  }
};
initCloud().finally(mount);
setTimeout(mount, 1500);
