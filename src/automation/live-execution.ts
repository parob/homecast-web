// Homecast Automation Engine - Live execution event bus
//
// Tiny same-context pub/sub between the engine and any UI that wants to watch
// a run as it happens (the editor's live run view). The engine emits via
// emitExecutionEvent (wired in automation/index.ts); consumers subscribe per
// automation id.
//
// Same-context only: this reaches consumers in the WebView the engine runs in
// (the relay Mac), which is exactly where Community users edit. Remote
// transports are deliberately not wired yet:
//   - Community remote clients would ride local-broadcast
//     (`automation.execution_event`, listener-gated like relay activity).
//   - Cloud browser clients would need AutomationSyncManager.pushExecutionEvent
//     plus server fanout (homecast-cloud change).
// Remote "Run Test" therefore stays non-live and shows the returned trace.

import type { ExecutionEvent } from './types/execution';

type Listener = (e: ExecutionEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeExecutionEvents(automationId: string, cb: Listener): () => void {
  let set = listeners.get(automationId);
  if (!set) {
    set = new Set();
    listeners.set(automationId, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) listeners.delete(automationId);
  };
}

export function emitExecutionEvent(e: ExecutionEvent): void {
  const set = listeners.get(e.automationId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(e);
    } catch (err) {
      // A broken listener must not break the engine's action chain.
      console.warn('[LiveExecution] listener failed', err);
    }
  }
}

export function hasExecutionEventListeners(automationId: string): boolean {
  return listeners.has(automationId);
}
