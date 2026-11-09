/**
 * NativeRelayWebSocket — a thin adapter that speaks the browser WebSocket API
 * to `ServerWebSocket`, but routes bytes through a native WKWebView bridge
 * (`webkit.messageHandlers.relayWs`) so the underlying socket is an Apple
 * `URLSessionWebSocketTask` managed by the Mac app.
 *
 * See app-ios-macos/Sources/Server/RelayWebSocketBridge.swift for the Swift
 * side. Lifecycle events arrive on `window.__relay_ws_event`, which the
 * Swift-injected userScript installs as a central dispatcher.
 *
 * Only the narrow surface that `websocket.ts` actually uses is implemented:
 *   - readyState + OPEN/CONNECTING/CLOSING/CLOSED constants
 *   - onopen / onmessage / onerror / onclose
 *   - send(string)
 *   - close(code?, reason?)
 */

type RelayWsConnect = { action: 'connect'; socketId: string; url: string };
type RelayWsSend = { action: 'send'; socketId: string; data: string };
type RelayWsClose = { action: 'close'; socketId: string; code: number; reason?: string };
type RelayWsAction = RelayWsConnect | RelayWsSend | RelayWsClose;

// Independent of URLSession callbacks: a native handshake can remain silent
// through a network interruption. The relay must still reach its retry loop.
const CONNECT_TIMEOUT_MS = 30_000;

type RelayWsEvent =
  | { socketId: string; type: 'sent'; bytes: number }
  | { socketId: string; type: 'open' }
  | { socketId: string; type: 'message'; data: string }
  | { socketId: string; type: 'error'; message?: string }
  | { socketId: string; type: 'close'; code: number; reason?: string; wasClean: boolean };

interface RelayWsMessageHandler {
  postMessage: (msg: RelayWsAction) => void;
}

interface RelayWsWindow {
  homecastNativeRelayWs?: boolean;
  homecastNativeRelayWsBackpressure?: boolean;
  __relay_ws_sockets?: Record<string, NativeRelayWebSocket>;
  __relay_ws_event?: (payload: RelayWsEvent) => void;
  webkit?: { messageHandlers?: { relayWs?: RelayWsMessageHandler } };
}

function relayWin(): RelayWsWindow {
  return window as unknown as RelayWsWindow;
}

function post(msg: RelayWsAction): void {
  const handler = relayWin().webkit?.messageHandlers?.relayWs;
  if (!handler) {
    throw new Error(`Native relay bridge missing: ${msg.action}`);
  }
  handler.postMessage(msg);
}

function newSocketId(): string {
  return `rws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class NativeRelayWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState: number = NativeRelayWebSocket.CONNECTING;
  bufferedAmount = 0;
  readonly url: string;
  readonly protocol: string = '';

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  private readonly socketId: string;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.url = url;
    this.socketId = newSocketId();
    const win = relayWin();
    const sockets = (win.__relay_ws_sockets = win.__relay_ws_sockets ?? {});
    sockets[this.socketId] = this;
    this.connectTimer = setTimeout(() => {
      if (this.readyState !== this.CONNECTING) return;
      console.warn('[RelayWS] Native connection opening timed out after 30000ms');
      this.retireFailedAttempt('connect-timeout');
    }, CONNECT_TIMEOUT_MS);
    try {
      post({ action: 'connect', socketId: this.socketId, url });
    } catch {
      // ServerWebSocket installs its handlers immediately after construction.
      queueMicrotask(() => this.retireFailedAttempt('native-bridge-unavailable'));
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private retireFailedAttempt(reason: string): void {
    if (this.readyState !== this.CONNECTING) return;
    this.readyState = this.CLOSING;
    this.clearConnectTimer();
    try {
      post({ action: 'close', socketId: this.socketId, code: 4000, reason });
    } catch { /* Synthetic close below is independent of the native bridge. */ }
    this._onError(reason);
    this._onClose(1006, reason, false);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== this.OPEN) {
      // Match browser WebSocket: throw if not open. ServerWebSocket always
      // guards with readyState checks, but keep parity.
      throw new DOMException(
        `NativeRelayWebSocket send in state ${this.readyState}`,
        'InvalidStateError',
      );
    }
    if (typeof data !== 'string') {
      throw new DOMException(
        'NativeRelayWebSocket only supports string payloads',
        'NotSupportedError',
      );
    }
    if (relayWin().homecastNativeRelayWsBackpressure) this.bufferedAmount += new TextEncoder().encode(data).byteLength;
    post({ action: 'send', socketId: this.socketId, data });
  }

  /** Native send completion, available on lease-aware camera relays. Older
   * shells keep bufferedAmount at zero because they do not acknowledge sends. */
  _onSent(bytes: number): void {
    if (Number.isFinite(bytes) && bytes >= 0) this.bufferedAmount = Math.max(0, this.bufferedAmount - bytes);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === this.CLOSED || this.readyState === this.CLOSING) {
      return;
    }
    this.readyState = this.CLOSING;
    this.clearConnectTimer();
    try {
      post({ action: 'close', socketId: this.socketId, code: code ?? 1000, reason });
    } catch { /* Cleanup must work even after the native handler disappears. */ }
    // Retire the JS registry too; a silent native layer may never confirm.
    this._onClose(code ?? 1000, reason, true);
  }

  /** @internal — invoked by the dispatcher in window.__relay_ws_event */
  _onOpen(): void {
    if (this.readyState !== this.CONNECTING) return;
    this.clearConnectTimer();
    this.readyState = this.OPEN;
    try {
      this.onopen?.(new Event('open'));
    } catch (e) {
      console.error('[RelayWS] onopen handler threw:', e);
    }
  }

  /** @internal */
  _onMessage(data: string): void {
    if (this.readyState !== this.OPEN) return;
    try {
      this.onmessage?.(new MessageEvent('message', { data }));
    } catch (e) {
      console.error('[RelayWS] onmessage handler threw:', e);
    }
  }

  /** @internal */
  _onError(_message?: string): void {
    if (this.readyState === this.CLOSED) return;
    try {
      this.onerror?.(new Event('error'));
    } catch (e) {
      console.error('[RelayWS] onerror handler threw:', e);
    }
  }

  /** @internal */
  _onClose(code: number, reason: string | undefined, wasClean: boolean): void {
    if (this.readyState === this.CLOSED) return;
    this.clearConnectTimer();
    this.readyState = this.CLOSED;
    this.bufferedAmount = 0;
    try {
      this.onclose?.(new CloseEvent('close', {
        code,
        reason: reason ?? '',
        wasClean,
      }));
    } catch (e) {
      console.error('[RelayWS] onclose handler threw:', e);
    } finally {
      const sockets = relayWin().__relay_ws_sockets;
      if (sockets) delete sockets[this.socketId];
    }
  }
}

/**
 * Whether the native relay WebSocket transport is available and enabled.
 * Off by default unless the Swift userScript has set the marker flag.
 * A `localStorage` kill-switch lets us drop back to the browser WebSocket
 * without a redeploy if anything goes wrong in the wild.
 */
export function shouldUseNativeRelayWs(): boolean {
  if (typeof window === 'undefined') return false;
  const win = relayWin();
  if (win.homecastNativeRelayWs !== true) return false;
  if (!win.webkit?.messageHandlers?.relayWs) return false;
  try {
    if (localStorage.getItem('homecast.disableNativeRelayWs') === '1') return false;
  } catch {
    // localStorage can throw in private-mode / sandboxed contexts; fall through.
  }
  return true;
}
