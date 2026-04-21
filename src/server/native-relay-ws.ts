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

type RelayWsEvent =
  | { socketId: string; type: 'open' }
  | { socketId: string; type: 'message'; data: string }
  | { socketId: string; type: 'error'; message?: string }
  | { socketId: string; type: 'close'; code: number; reason?: string; wasClean: boolean };

interface RelayWsMessageHandler {
  postMessage: (msg: RelayWsAction) => void;
}

interface RelayWsWindow {
  homecastNativeRelayWs?: boolean;
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
    console.error('[RelayWS] Native bridge missing when posting', msg.action);
    return;
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
  readonly url: string;
  readonly protocol: string = '';

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  private readonly socketId: string;

  constructor(url: string) {
    this.url = url;
    this.socketId = newSocketId();
    const win = relayWin();
    const sockets = (win.__relay_ws_sockets = win.__relay_ws_sockets ?? {});
    sockets[this.socketId] = this;
    post({ action: 'connect', socketId: this.socketId, url });
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
    post({ action: 'send', socketId: this.socketId, data });
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === this.CLOSED || this.readyState === this.CLOSING) {
      return;
    }
    this.readyState = this.CLOSING;
    post({
      action: 'close',
      socketId: this.socketId,
      code: code ?? 1000,
      reason,
    });
  }

  /** @internal — invoked by the dispatcher in window.__relay_ws_event */
  _onOpen(): void {
    this.readyState = this.OPEN;
    try {
      this.onopen?.(new Event('open'));
    } catch (e) {
      console.error('[RelayWS] onopen handler threw:', e);
    }
  }

  /** @internal */
  _onMessage(data: string): void {
    try {
      this.onmessage?.(new MessageEvent('message', { data }));
    } catch (e) {
      console.error('[RelayWS] onmessage handler threw:', e);
    }
  }

  /** @internal */
  _onError(_message?: string): void {
    try {
      this.onerror?.(new Event('error'));
    } catch (e) {
      console.error('[RelayWS] onerror handler threw:', e);
    }
  }

  /** @internal */
  _onClose(code: number, reason: string | undefined, wasClean: boolean): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
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
