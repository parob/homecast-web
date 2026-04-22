import { useCallback, useEffect, useSyncExternalStore } from "react";
import { CURRENT_ENV, OTHER_ENV, otherEnvClient, type HomecastEnv } from "@/lib/apollo-other-env";

export interface AdminEnvVisibility {
  production: boolean;
  staging: boolean;
}

const STORAGE_KEY = "homecast-admin-env-visibility";

function readStored(): AdminEnvVisibility {
  if (typeof window === "undefined") return { production: true, staging: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.production === "boolean" && typeof parsed?.staging === "boolean") {
        return { production: parsed.production, staging: parsed.staging };
      }
    }
  } catch { /* ignore */ }
  return { production: true, staging: true };
}

// Module-level store so all components share the same state + same storage
// events propagate across tabs. `useSyncExternalStore` re-renders subscribers
// whenever we bump `version`.
let state: AdminEnvVisibility = readStored();
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota / private mode — ignore */ }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): AdminEnvVisibility {
  return state;
}

// Cross-tab sync via storage events.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      state = readStored();
      emit();
    }
  });
}

/**
 * Admin-panel env visibility toggle. Determines which environment's data each
 * admin page should render. Persists to localStorage, syncs across tabs.
 *
 * Invariant: at least one env must be visible. Attempting to turn off the
 * last visible env is rejected.
 *
 * On single-env installs (Community mode, no `otherEnvClient`), staging has
 * no meaning — we keep the UI consistent by always reporting
 * `otherAvailable=false` and clamping staging visibility to off.
 */
export function useAdminEnvToggle() {
  const visibility = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // When there's no "other" env, we can't meaningfully hide the current one.
  useEffect(() => {
    if (!OTHER_ENV) {
      if (!visibility.production || !visibility.staging) {
        state = { production: true, staging: true };
        persist();
        emit();
      }
    }
  }, [visibility.production, visibility.staging]);

  const setVisible = useCallback((env: HomecastEnv, visible: boolean) => {
    // Invariant: at least one env visible.
    const next: AdminEnvVisibility = { ...state, [env]: visible };
    if (!next.production && !next.staging) return;
    state = next;
    persist();
    emit();
  }, []);

  const toggle = useCallback((env: HomecastEnv) => {
    setVisible(env, !state[env]);
  }, [setVisible]);

  const showProduction = visibility.production;
  const showStaging = visibility.staging;
  const both = showProduction && showStaging;
  const onlyOne = !both && (showProduction || showStaging);

  // Does the current view include the current server's env?
  const showCurrent = CURRENT_ENV ? visibility[CURRENT_ENV] : true;
  // Does it include the other env?
  const showOther = OTHER_ENV ? visibility[OTHER_ENV] : false;

  return {
    visibility,
    currentEnv: CURRENT_ENV,
    otherEnv: OTHER_ENV,
    otherAvailable: !!otherEnvClient,
    showProduction,
    showStaging,
    showCurrent,
    showOther,
    showBoth: both,
    showOnlyOne: onlyOne,
    setProductionVisible: (v: boolean) => setVisible("production", v),
    setStagingVisible: (v: boolean) => setVisible("staging", v),
    toggle,
  };
}

// Non-reactive snapshot, useful outside React.
export function getAdminEnvVisibilitySnapshot(): AdminEnvVisibility {
  return state;
}
