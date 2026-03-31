/// <reference types="vite/client" />

// WebKit message handler types (for Mac app WebView bridge)
interface WebKitMessageHandler {
  postMessage(message: { action: string; [key: string]: unknown }): void;
}

interface WebKitMessageHandlers {
  homecast?: WebKitMessageHandler;
}

interface WebKit {
  messageHandlers?: WebKitMessageHandlers;
}

// HomeKit bridge callback and event types
interface HomeKitCallbackEntry {
  resolve: (value: unknown) => void;
  reject: (error: { code: string; message: string }) => void;
}

interface HomeKitBridge {
  _callbackIdCounter: number;
  _generateCallbackId(): string;
  call<T>(method: string, payload?: Record<string, unknown>): Promise<T>;
  onEvent(handler: (event: HomeKitEventPayload) => void): () => void;
}

interface HomeKitEventPayload {
  type: string;
  accessoryId: string;
  characteristicType?: string;
  value?: unknown;
  isReachable?: boolean;
}

declare global {
  interface Window {
    webkit?: WebKit;
    // Platform detection flags (set by Mac/iOS app)
    isHomecastApp?: boolean;
    isHomecastMacApp?: boolean;
    isHomecastIOSApp?: boolean;
    // HomeKit relay capability flag (Mac only)
    isHomeKitRelayCapable?: boolean;
    // Native app version (e.g. "1.0.1") — injected by Mac/iOS app
    homecastAppVersion?: string;
    // Native app git commit hash (e.g. "abc1234") — injected by Mac/iOS app
    homecastAppBuild?: string;
    // Debug: use localhost:3000 for WebSocket connection
    homecastUseLocalhost?: boolean;
    // HomeKit bridge API (injected by Mac app)
    homekit?: HomeKitBridge;
    // Internal: callbacks for async bridge responses
    __homekit_callbacks?: Record<string, HomeKitCallbackEntry>;
    // Internal: event handlers for HomeKit events
    __homekit_event_handlers?: Array<(event: HomeKitEventPayload) => void>;
    // Internal: callback function called by native bridge
    __homekit_callback?: (payload: {
      callbackId: string;
      success: boolean;
      data?: unknown;
      error?: { code: string; message: string };
    }) => void;
    // Internal: event function called by native bridge
    __homekit_event?: (payload: HomeKitEventPayload) => void;
  }
}

export {};
