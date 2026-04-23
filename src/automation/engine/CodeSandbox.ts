// Sandbox for the Code action node.
//
// User-authored JavaScript must not have access to window, the Swift bridge
// (window.homekit / window.webkit), IndexedDB, cookies, fetch, WebSocket, or
// any other capability that would let it exfiltrate secrets or pivot into the
// relay's authority. The production sandbox runs the code in a dedicated Web
// Worker spawned from a Blob URL, with network/storage globals shadowed to
// throwing stubs before user code runs.

export interface CodeInput {
  trigger: unknown;
  variables: Record<string, unknown>;
  nodes: Record<string, unknown>;
  /** accessoryId → characteristicType → value. Exposed to user code as `input.states(id, type)`. */
  stateSnapshot: Record<string, Record<string, unknown>>;
}

export interface CodeSandbox {
  run(code: string, input: CodeInput, timeoutMs: number): Promise<unknown>;
}

/**
 * Web Worker–based sandbox. Runs user code in a separate realm with no DOM,
 * no `window`, no Swift bridge, and with fetch/XHR/WebSocket/IndexedDB shadowed
 * to throw. Timeouts terminate the worker.
 */
export class WorkerCodeSandbox implements CodeSandbox {
  async run(code: string, input: CodeInput, timeoutMs: number): Promise<unknown> {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
      throw new Error('CodeSandbox: Worker/Blob/URL APIs not available in this runtime');
    }

    const workerSource = buildWorkerSource();
    const blob = new Blob([workerSource], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    try {
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error(`Code execution timeout (${timeoutMs}ms)`));
        }, timeoutMs);

        worker.onmessage = (e: MessageEvent) => {
          clearTimeout(timer);
          const data = e.data as { ok: boolean; value?: unknown; error?: string };
          if (data && data.ok) resolve(data.value);
          else reject(new Error(data?.error ?? 'Unknown sandbox error'));
        };

        worker.onerror = (e: ErrorEvent) => {
          clearTimeout(timer);
          reject(new Error(e.message || 'Worker error'));
        };

        worker.postMessage({ code, input });
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * The script that runs inside the Worker. It:
 * 1. Shadows dangerous globals (fetch, XHR, WebSocket, IndexedDB, importScripts,
 *    Notification, navigator.sendBeacon) with throwing stubs.
 * 2. Receives { code, input } via postMessage.
 * 3. Builds a `states(id, type)` helper backed by a pre-snapshotted map, so the
 *    user code keeps its synchronous API without the worker needing to reach
 *    back across the message boundary.
 * 4. Executes the user code via `new Function('input', …)` and posts the result
 *    (or error) back to the parent.
 */
function buildWorkerSource(): string {
  return `
'use strict';

(function shadowGlobals() {
  var thrower = function (name) {
    return function () {
      throw new Error('[CodeSandbox] ' + name + ' is not available inside Code nodes');
    };
  };
  var blocked = [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'importScripts',
    'Notification',
    'indexedDB',
    'caches',
    'openDatabase',
    'Request',
    'Response',
  ];
  for (var i = 0; i < blocked.length; i++) {
    try {
      Object.defineProperty(self, blocked[i], {
        configurable: false,
        get: thrower(blocked[i]),
        set: function () {},
      });
    } catch (_) { /* already defined non-configurable */ }
  }
  try {
    if (self.navigator && typeof self.navigator === 'object') {
      try { self.navigator.sendBeacon = thrower('navigator.sendBeacon'); } catch (_) {}
    }
  } catch (_) {}
})();

self.onmessage = function (e) {
  var payload = e.data || {};
  var code = payload.code;
  var input = payload.input || {};
  var snapshot = input.stateSnapshot || {};
  var runtimeInput = {
    trigger: input.trigger,
    variables: input.variables,
    nodes: input.nodes,
    states: function (accessoryId, characteristicType) {
      var byAcc = snapshot[accessoryId];
      return byAcc ? byAcc[characteristicType] : undefined;
    },
  };
  try {
    var fn = new Function('input', '"use strict";\\n' + code);
    Promise.resolve(fn(runtimeInput)).then(
      function (value) { self.postMessage({ ok: true, value: value }); },
      function (err) { self.postMessage({ ok: false, error: String(err && err.message || err) }); }
    );
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
`;
}
