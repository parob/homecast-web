// Homecast Automation Engine - Sync Manager
// Bidirectional sync: server ↔ relay via WebSocket

import type { AutomationEngine } from '../engine/AutomationEngine';
import type { Automation } from '../types/automation';
import type { ExecutionTrace } from '../types/execution';

/** Interface for the WebSocket connection used by the sync manager */
export interface SyncTransport {
  /** Send a typed message to the server */
  sendMessage(type: string, payload: Record<string, unknown>): void;
  /** Register a handler for a specific message type. Returns unsubscribe. */
  onMessage(type: string, handler: (payload: Record<string, unknown>) => void): () => void;
  /** Request automation configs from the server */
  request(action: string, payload?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Manages bidirectional sync between the server and the relay's automation engine.
 *
 * Server → Relay:
 * - automation.sync_all: Full config load on connect
 * - automation.sync: Single automation update
 * - automation.delete: Automation removed
 * - automation.webhook_trigger: Forward webhook to engine
 * - automation.notification_response: Forward notification action to engine
 *
 * Relay → Server:
 * - automation.trace: Execution trace completed
 * - automation.helper_state: Helper state changed
 */
export class AutomationSyncManager {
  private unsubscribers: (() => void)[] = [];
  private traceQueue: ExecutionTrace[] = [];
  private connected = false;

  constructor(
    private engine: AutomationEngine,
    private transport: SyncTransport,
  ) {}

  /**
   * Start listening for sync messages and load initial configs.
   */
  async initialize(): Promise<void> {
    // Register message handlers
    this.unsubscribers.push(
      this.transport.onMessage('automation.sync_all', (payload) => {
        this.handleSyncAll(payload);
      }),
    );

    this.unsubscribers.push(
      this.transport.onMessage('automation.sync', (payload) => {
        this.handleSync(payload);
      }),
    );

    this.unsubscribers.push(
      this.transport.onMessage('automation.delete', (payload) => {
        this.handleDelete(payload);
      }),
    );

    this.unsubscribers.push(
      this.transport.onMessage('automation.webhook_trigger', (payload) => {
        this.handleWebhookTrigger(payload);
      }),
    );

    this.unsubscribers.push(
      this.transport.onMessage('automation.notification_response', (payload) => {
        this.handleNotificationResponse(payload);
      }),
    );

    this.connected = true;

    // Request initial configs from server
    await this.requestFullSync();

    // Flush any queued traces
    this.flushTraceQueue();
  }

  /**
   * Request all automation configs from the server.
   *
   * In cloud mode, the server proactively pushes automation.sync_all on relay
   * connect (before this is called). The WebSocket layer buffers that push and
   * replays it once the engine is ready, so this method is a no-op — the push
   * is the authoritative sync mechanism.
   */
  async requestFullSync(): Promise<void> {
    // Server pushes automation.sync_all on connect; the WS layer buffers and
    // replays it after engine init. No explicit request needed.
  }

  // ============================================================
  // Inbound message handlers
  // ============================================================

  private handleSyncAll(payload: Record<string, unknown>): void {
    const automations = payload.automations as Automation[] | undefined;
    if (automations) {
      this.engine.loadAutomations(automations);
    }
  }

  private handleSync(payload: Record<string, unknown>): void {
    const automation = payload.automation as Automation | undefined;
    if (automation) {
      this.engine.updateAutomation(automation);
    }
  }

  private handleDelete(payload: Record<string, unknown>): void {
    const automationId = payload.automationId as string | undefined;
    if (automationId) {
      this.engine.removeAutomation(automationId);
    }
  }

  private handleWebhookTrigger(payload: Record<string, unknown>): void {
    const webhookId = payload.webhookId as string | undefined;
    if (webhookId) {
      this.engine.fireEvent(`webhook.${webhookId}`, payload);
    }
  }

  private handleNotificationResponse(payload: Record<string, unknown>): void {
    const action = payload.action as string | undefined;
    if (action) {
      this.engine.fireEvent('notification_action', payload);
    }
  }

  // ============================================================
  // Outbound: push traces and helper state
  // ============================================================

  /**
   * Send a completed execution trace to the server.
   */
  pushTrace(trace: ExecutionTrace): void {
    if (this.connected) {
      this.transport.sendMessage('automation.trace', { trace });
    } else {
      this.traceQueue.push(trace);
    }
  }

  /**
   * Push helper state update to the server for persistence.
   */
  pushHelperState(helperId: string, state: unknown): void {
    if (this.connected) {
      this.transport.sendMessage('automation.helper_state', { helperId, state });
    }
  }

  private flushTraceQueue(): void {
    while (this.traceQueue.length > 0) {
      const trace = this.traceQueue.shift()!;
      this.transport.sendMessage('automation.trace', { trace });
    }
  }

  // ============================================================
  // Teardown
  // ============================================================

  teardown(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.connected = false;
  }
}
