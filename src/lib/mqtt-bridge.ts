/// MQTT broker configuration (mirrors Swift MQTTBrokerConfig)
export interface MQTTBrokerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  hasPassword?: boolean;
  useTLS: boolean;
  topicPrefix: string;
  haDiscovery: boolean;
  haDiscoveryPrefix: string;
  enabled: boolean;
  status?: 'connected' | 'connecting' | 'disconnected' | string;
}

// Callback registry for async responses from Swift
const callbacks: Record<string, (data: any) => void> = {};

// Install global callback handler (called by Swift via evaluateJavaScript)
if (typeof window !== 'undefined') {
  (window as any).__mqtt_callback = (callbackId: string, jsonString: string) => {
    const cb = callbacks[callbackId];
    if (cb) {
      delete callbacks[callbackId];
      try {
        cb(JSON.parse(jsonString));
      } catch {
        cb(jsonString);
      }
    }
  };
}

function callMQTT(method: string, params: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (!w.webkit?.messageHandlers?.homecast) {
      reject(new Error('MQTT bridge not available (not in Mac app)'));
      return;
    }

    const callbackId = `mqtt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    callbacks[callbackId] = resolve;

    // Timeout after 15s
    setTimeout(() => {
      if (callbacks[callbackId]) {
        delete callbacks[callbackId];
        reject(new Error('MQTT bridge timeout'));
      }
    }, 15000);

    w.webkit.messageHandlers.homecast.postMessage({
      action: 'mqtt',
      method,
      callbackId,
      ...params,
    });
  });
}

/// Get all broker configs grouped by home ID, with live connection status.
export function getMQTTBrokers(): Promise<Record<string, MQTTBrokerConfig[]>> {
  return callMQTT('getBrokers');
}

/// Add a new MQTT broker for a home.
export function addMQTTBroker(
  homeId: string,
  config: {
    name: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    useTLS: boolean;
    topicPrefix: string;
    haDiscovery: boolean;
    haDiscoveryPrefix: string;
  }
): Promise<MQTTBrokerConfig> {
  return callMQTT('addBroker', { homeId, ...config });
}

/// Remove a broker from a home.
export function removeMQTTBroker(homeId: string, brokerId: string): Promise<void> {
  return callMQTT('removeBroker', { homeId, brokerId });
}

/// Update an existing broker's configuration.
export function updateMQTTBroker(
  homeId: string,
  brokerId: string,
  updates: Partial<MQTTBrokerConfig>
): Promise<void> {
  return callMQTT('updateBroker', { homeId, brokerId, updates });
}

/// Test a broker connection (connect → CONNACK → disconnect).
export function testMQTTConnection(config: {
  host: string;
  port: number;
  username?: string;
  password?: string;
  useTLS: boolean;
}): Promise<{ success: boolean; error?: string }> {
  return callMQTT('testConnection', config);
}

/// Check if the MQTT bridge is available (running in the Mac app).
export function isMQTTAvailable(): boolean {
  return !!(window as any).webkit?.messageHandlers?.homecast;
}
