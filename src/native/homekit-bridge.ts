/**
 * TypeScript wrapper for the native HomeKit bridge injected by the Mac app.
 * Provides type-safe access to HomeKit operations through the WebView JS bridge.
 */

// Types for HomeKit data structures
export interface HomeKitHome {
  id: string;
  name: string;
  isPrimary: boolean;
  roomCount: number;
  accessoryCount: number;
  role?: string;
  relayConnected?: boolean;
  relayLastSeenAt?: string | null;
  relayId?: string | null;
  relayOwnerEmail?: string | null;
  isCloudManaged?: boolean;
  roomFingerprint?: string;
}

export interface HomeKitRoom {
  id: string;
  name: string;
  accessoryCount: number;
}

export interface HomeKitZone {
  id: string;
  name: string;
  roomIds: string[];
}

export interface HomeKitServiceGroup {
  id: string;
  name: string;
  serviceIds: string[];
  accessoryIds: string[];
  homeId?: string;
}

export interface HomeKitCharacteristic {
  id: string;
  characteristicType: string;
  value?: unknown;
  isReadable: boolean;
  isWritable: boolean;
  validValues?: number[];
  minValue?: number;
  maxValue?: number;
  stepValue?: number;
}

export interface HomeKitService {
  id: string;
  name: string;
  serviceType: string;
  characteristics: HomeKitCharacteristic[];
}

export interface HomeKitAccessory {
  id: string;
  name: string;
  homeId?: string;
  roomId?: string;
  roomName?: string;
  category: string;
  isReachable: boolean;
  services: HomeKitService[];
}

export interface HomeKitScene {
  id: string;
  name: string;
  actionCount: number;
}

export interface AutomationAction {
  accessoryId: string;
  accessoryName: string;
  characteristicType: string;
  targetValue: unknown;
}

export interface AutomationEvent {
  type: 'characteristic' | 'characteristicThresholdRange' | 'location' | 'presence' | 'significantTime' | 'calendar' | 'duration' | 'unknown';
  accessoryId?: string;
  accessoryName?: string;
  characteristicType?: string;
  triggerValue?: unknown;
  thresholdMin?: unknown;
  thresholdMax?: unknown;
  significantEvent?: string;
  offsetMinutes?: number;
  latitude?: number;
  longitude?: number;
  radius?: number;
  notifyOnEntry?: boolean;
  notifyOnExit?: boolean;
  presenceType?: string;
  presenceEvent?: string;
  calendarComponents?: Record<string, number>;
  durationSeconds?: number;
}

export interface AutomationCondition {
  type: string;
  accessoryId?: string;
  characteristicType?: string;
  comparisonOperator?: string;
  value?: unknown;
}

export interface AutomationTrigger {
  type: 'timer' | 'event' | 'unknown';
  fireDate?: string;
  recurrence?: Record<string, number>;
  timeZone?: string;
  events?: AutomationEvent[];
  endEvents?: AutomationEvent[];
  recurrences?: Array<Record<string, number>>;
  executeOnce?: boolean;
  activationState?: string;
}

export interface HomeKitAutomation {
  id: string;
  name: string;
  isEnabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  lastFireDate?: string;
  homeId?: string;
}

export interface HomeKitError {
  code: string;
  message: string;
}

export interface HomeKitEvent {
  type: 'characteristic.updated' | 'accessory.reachability' | 'homes.updated';
  accessoryId: string;
  // Context fields provided by native bridge for event routing
  homeId?: string;
  roomId?: string;
  serviceGroupIds?: string[];
  // Event-specific fields
  characteristicType?: string;
  value?: unknown;
  isReachable?: boolean;
}

// Type for the native bridge injected by the Mac app
interface NativeBridge {
  call<T>(method: string, payload?: Record<string, unknown>): Promise<T>;
  onEvent(handler: (event: HomeKitEvent) => void): () => void;
}

// Check if the native bridge is available
export function isRelayCapable(): boolean {
  return (window as Window & { isHomeKitRelayCapable?: boolean }).isHomeKitRelayCapable === true;
}

// Check if the relay is enabled (capable + not manually disabled)
export function isRelayEnabled(): boolean {
  return isRelayCapable() && localStorage.getItem('homecast-relay-disabled') !== 'true';
}

// Get the native bridge instance
function getNativeBridge(): NativeBridge | null {
  const win = window as Window & { homekit?: NativeBridge };
  if (win.homekit) {
    return win.homekit;
  }
  return null;
}

/**
 * HomeKit bridge API for the web app.
 * Wraps the native bridge with type-safe methods.
 */
export const HomeKit = {
  /**
   * Check if the bridge is available (running in Mac app WebView)
   */
  isAvailable(): boolean {
    return getNativeBridge() !== null;
  },

  /**
   * List all homes
   */
  async listHomes(): Promise<HomeKitHome[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitHome[]>('homes.list');
  },

  /**
   * List rooms in a home
   */
  async listRooms(homeId: string): Promise<HomeKitRoom[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitRoom[]>('rooms.list', { homeId });
  },

  /**
   * List zones in a home
   */
  async listZones(homeId: string): Promise<HomeKitZone[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitZone[]>('zones.list', { homeId });
  },

  /**
   * List service groups in a home
   */
  async listServiceGroups(homeId: string): Promise<HomeKitServiceGroup[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitServiceGroup[]>('serviceGroups.list', { homeId });
  },

  /**
   * Set a characteristic on all services in a group
   */
  async setServiceGroupCharacteristic(
    groupId: string,
    characteristicType: string,
    value: unknown,
    homeId?: string
  ): Promise<{ success: boolean; groupId: string; successCount: number }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('serviceGroup.set', {
      groupId,
      characteristicType,
      value,
      ...(homeId && { homeId }),
    });
  },

  /**
   * List accessories, optionally filtered by home or room
   */
  async listAccessories(options?: {
    homeId?: string;
    roomId?: string;
    includeValues?: boolean;
  }): Promise<HomeKitAccessory[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitAccessory[]>('accessories.list', options || {});
  },

  /**
   * Get a single accessory with full details
   */
  async getAccessory(accessoryId: string): Promise<HomeKitAccessory> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitAccessory>('accessory.get', { accessoryId });
  },

  /**
   * Refresh an accessory's cached values
   */
  async refreshAccessory(accessoryId: string): Promise<{ success: boolean; accessoryId: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('accessory.refresh', { accessoryId });
  },

  /**
   * Read a characteristic value
   */
  async getCharacteristic(
    accessoryId: string,
    characteristicType: string
  ): Promise<{ accessoryId: string; characteristicType: string; value: unknown }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('characteristic.get', { accessoryId, characteristicType });
  },

  /**
   * Set a characteristic value
   */
  async setCharacteristic(
    accessoryId: string,
    characteristicType: string,
    value: unknown
  ): Promise<{ success: boolean; accessoryId: string; characteristicType: string; value: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('characteristic.set', { accessoryId, characteristicType, value });
  },

  /**
   * List scenes in a home
   */
  async listScenes(homeId: string): Promise<HomeKitScene[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitScene[]>('scenes.list', { homeId });
  },

  /**
   * Execute a scene
   */
  async executeScene(sceneId: string): Promise<{ success: boolean; sceneId: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('scene.execute', { sceneId });
  },

  /**
   * List automations in a home
   */
  async listAutomations(homeId: string): Promise<HomeKitAutomation[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    const result = await bridge.call<{ automations: HomeKitAutomation[] }>('automations.list', { homeId });
    return result.automations;
  },

  /**
   * Create a new automation
   */
  async createAutomation(homeId: string, name: string, trigger: AutomationTrigger, actions: Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }>): Promise<HomeKitAutomation> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitAutomation>('automation.create', { homeId, name, trigger, actions });
  },

  /**
   * Update an existing automation
   */
  async updateAutomation(automationId: string, params: { name?: string; trigger?: AutomationTrigger; actions?: Array<{ accessoryId: string; characteristicType: string; targetValue: unknown }>; enabled?: boolean }): Promise<HomeKitAutomation> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitAutomation>('automation.update', { automationId, ...params });
  },

  /**
   * Delete an automation
   */
  async deleteAutomation(automationId: string): Promise<{ success: boolean; automationId: string }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('automation.delete', { automationId });
  },

  /**
   * Enable or disable an automation
   */
  async setAutomationEnabled(automationId: string, enabled: boolean): Promise<HomeKitAutomation> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    const action = enabled ? 'automation.enable' : 'automation.disable';
    return bridge.call<HomeKitAutomation>(action, { automationId });
  },

  /**
   * Set state using simplified format: {room: {accessory: {prop: value}}}
   */
  async setState(
    state: Record<string, Record<string, Record<string, unknown>>>,
    homeId?: string
  ): Promise<{ success: boolean; ok: number; failed: string[] }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('state.set', { state, ...(homeId && { homeId }) });
  },

  /**
   * Start observing characteristic changes
   */
  async startObserving(): Promise<{ success: boolean; observing: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('observe.start');
  },

  /**
   * Stop observing characteristic changes
   */
  async stopObserving(): Promise<{ success: boolean; observing: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('observe.stop');
  },

  /**
   * Reset the observation timeout (called when server confirms listeners exist)
   */
  async resetObservationTimeout(): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('observe.reset');
  },

  /**
   * Subscribe to HomeKit events (characteristic updates, reachability changes)
   * Returns an unsubscribe function.
   */
  onEvent(handler: (event: HomeKitEvent) => void): () => void {
    const bridge = getNativeBridge();
    if (!bridge) {
      console.warn('[HomeKit] Bridge not available, event subscription ignored');
      return () => {};
    }
    return bridge.onEvent(handler);
  },

  // Debug methods
  /**
   * Get relay logs from the native bridge
   */
  async getRelayLogs(): Promise<RelayLogEntry[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<RelayLogEntry[]>('debug.getRelayLogs');
  },

  /**
   * Get webview console logs from the native bridge
   */
  async getWebViewLogs(): Promise<WebViewLogEntry[]> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<WebViewLogEntry[]>('debug.getWebViewLogs');
  },

  /**
   * Get HomeKit stats from the native bridge
   */
  async getStats(): Promise<HomeKitStats> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call<HomeKitStats>('debug.getStats');
  },

  /**
   * Clear relay logs
   */
  async clearRelayLogs(): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('debug.clearRelayLogs');
  },

  /**
   * Clear webview logs
   */
  async clearWebViewLogs(): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('debug.clearWebViewLogs');
  },

  /**
   * Get launch at login status (Mac app only, requires updated app)
   */
  async getLaunchAtLogin(): Promise<{ launchAtLogin: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('settings.getLaunchAtLogin');
  },

  /**
   * Set launch at login (Mac app only, requires updated app)
   */
  async setLaunchAtLogin(enabled: boolean): Promise<{ success: boolean; launchAtLogin: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('settings.setLaunchAtLogin', { enabled });
  },

  // ---- Notifications ----

  /**
   * Show a local notification on macOS
   */
  async showNotification(title: string | undefined, message: string, data?: Record<string, unknown>): Promise<{ success: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('notification.show', { title, message, data });
  },

  /**
   * Request notification permission
   */
  async requestNotificationPermission(): Promise<{ granted: boolean }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('notification.requestPermission');
  },

  /**
   * Get the APNs device token (null if not registered)
   */
  async getAPNsToken(): Promise<{ token: string | null }> {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error('HomeKit bridge not available');
    return bridge.call('notification.getAPNsToken');
  },
};

// Debug types
export interface RelayLogEntry {
  id: string;
  timestamp: string;
  method: string;
  direction: 'REQ' | 'RESP' | 'EVENT';
  payload?: string;
  result?: string;
  error?: string;
  durationMs?: number;
}

export interface WebViewLogEntry {
  id: string;
  timestamp: string;
  message: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  source?: string;
}

export interface HomeKitStats {
  homes: number;
  accessories: number;
  accessoriesOnline: number;
  accessoriesOffline: number;
  rooms: number;
  zones: number;
  scenes: number;
  serviceGroups: number;
}

export default HomeKit;
