/**
 * Community mode: webhook delivery service.
 *
 * Subscribes to HomeKit events and delivers them to registered webhook
 * endpoints with HMAC-SHA256 signing, retries, and circuit breaking.
 *
 * Runs inside the Mac app's WKWebView — uses fetch() and Web Crypto API.
 */

import * as db from './local-db';
import { HomeKit } from '../native/homekit-bridge';
import { isCommunity } from '../lib/config';

// --- Types ---

interface Webhook {
  id: string;
  name: string;
  url: string;
  secret: string;
  status: 'active' | 'paused' | 'disabled';
  eventTypes: string[];
  homeIds: string[];
  roomIds: string[];
  accessoryIds: string[];
  collectionIds: string[];
  maxRetries: number;
  rateLimitPerMinute: number | null;
  timeoutMs: number;
  consecutiveFailures: number;
  lastTriggeredAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  createdAt: string;
}

interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  eventId: string;
  status: 'pending' | 'success' | 'failed' | 'retrying' | 'dead_letter';
  attemptNumber: number;
  maxAttempts: number;
  responseStatusCode: number | null;
  responseBody: string | null;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string;
  nextRetryAt: string | null;
}

// --- Secret Generation ---

export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'whsec_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function secretPrefix(secret: string): string {
  return secret.slice(0, 12) + '...';
}

// --- HMAC-SHA256 Signing ---

async function signPayload(secret: string, payload: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = new TextEncoder().encode(`${timestamp}.${payload}`);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

// --- Event Matching ---

function matchEvent(
  event: { homeId?: string | null; roomId?: string | null; accessoryId?: string },
  webhook: Webhook,
): boolean {
  if (webhook.homeIds.length > 0 && (!event.homeId || !webhook.homeIds.includes(event.homeId))) return false;
  if (webhook.roomIds.length > 0 && (!event.roomId || !webhook.roomIds.includes(event.roomId))) return false;
  if (webhook.accessoryIds.length > 0 && !webhook.accessoryIds.includes(event.accessoryId)) return false;
  return true;
}

// --- Delivery ---

const RETRY_BACKOFF = [1000, 2000, 4000, 8000, 16000];
const CIRCUIT_BREAKER_THRESHOLD = 5;

async function deliverWebhook(
  webhook: Webhook,
  eventPayload: Record<string, unknown>,
  eventType: string,
  attemptNumber = 1,
  deliveryId?: string,
  eventId?: string,
): Promise<void> {
  const id = deliveryId || crypto.randomUUID();
  const evtId = eventId || `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const maxAttempts = webhook.maxRetries + 1;

  // Circuit breaker check
  if (webhook.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    await db.putWebhookDelivery({
      id, webhookId: webhook.id, eventType, eventId: evtId,
      status: 'dead_letter', attemptNumber, maxAttempts,
      responseStatusCode: null, responseBody: null, latencyMs: null,
      errorMessage: 'Circuit breaker open — endpoint unreachable',
      createdAt: new Date().toISOString(), nextRetryAt: null,
    } satisfies WebhookDelivery);
    return;
  }

  const body = JSON.stringify({
    id: evtId,
    type: eventType,
    timestamp: new Date().toISOString(),
    webhook_id: webhook.id,
    data: eventPayload,
    metadata: { webhook_version: '1.0', webhook_name: webhook.name },
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signPayload(webhook.secret, body, timestamp);
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), webhook.timeoutMs);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Homecast-Webhook/1.0',
        'X-Homecast-Signature': signature,
        'X-Homecast-Timestamp': String(timestamp),
        'X-Homecast-Event': eventType,
        'X-Homecast-Delivery': id,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);
    const responseBody = await response.text().catch(() => null);

    if (response.ok) {
      // Success
      webhook.consecutiveFailures = 0;
      webhook.lastSuccessAt = new Date().toISOString();
      webhook.lastTriggeredAt = new Date().toISOString();
      await db.putWebhook(webhook);

      await db.putWebhookDelivery({
        id, webhookId: webhook.id, eventType, eventId: evtId,
        status: 'success', attemptNumber, maxAttempts,
        responseStatusCode: response.status, responseBody, latencyMs,
        errorMessage: null, createdAt: new Date().toISOString(), nextRetryAt: null,
      } satisfies WebhookDelivery);
    } else {
      throw new Error(`HTTP ${response.status}: ${responseBody?.slice(0, 200) || 'No response body'}`);
    }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    const errorMessage = err.name === 'AbortError' ? 'Request timeout' : err.message || 'Unknown error';
    const statusCode = errorMessage.match(/^HTTP (\d+)/)?.[1] ? parseInt(errorMessage.match(/^HTTP (\d+)/)![1]) : null;

    webhook.consecutiveFailures += 1;
    webhook.lastFailureAt = new Date().toISOString();
    webhook.lastFailureReason = errorMessage;
    webhook.lastTriggeredAt = new Date().toISOString();

    if (webhook.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      webhook.status = 'disabled';
    }
    await db.putWebhook(webhook);

    const canRetry = attemptNumber < maxAttempts;
    const nextRetryMs = canRetry ? RETRY_BACKOFF[Math.min(attemptNumber - 1, RETRY_BACKOFF.length - 1)] : null;

    await db.putWebhookDelivery({
      id, webhookId: webhook.id, eventType, eventId: evtId,
      status: canRetry ? 'retrying' : 'failed', attemptNumber, maxAttempts,
      responseStatusCode: statusCode, responseBody: null, latencyMs,
      errorMessage,
      createdAt: new Date().toISOString(),
      nextRetryAt: nextRetryMs ? new Date(Date.now() + nextRetryMs).toISOString() : null,
    } satisfies WebhookDelivery);

    if (canRetry && nextRetryMs) {
      setTimeout(() => {
        deliverWebhook(webhook, eventPayload, eventType, attemptNumber + 1, id, evtId);
      }, nextRetryMs);
    }
  }
}

// --- Event Handler ---

let unsubscribe: (() => void) | null = null;

export function initWebhooks(): void {
  if (!isCommunity) return;
  const w = window as Window & { isHomeKitRelayCapable?: boolean };
  if (!w.isHomeKitRelayCapable) return;

  console.log('[Webhooks] Initializing webhook event listener');

  unsubscribe = HomeKit.onEvent(async (event) => {
    if (event.type !== 'characteristic.updated') return;

    const webhooks = (await db.getWebhooks()) as Webhook[];
    const active = webhooks.filter(wh => wh.status === 'active');
    if (active.length === 0) return;

    const eventData = {
      accessoryId: event.accessoryId,
      characteristicType: event.characteristicType,
      value: event.value,
      homeId: event.homeId ?? null,
      roomId: (event as any).roomId ?? null,
    };

    for (const webhook of active) {
      // Check event type filter
      if (webhook.eventTypes.length > 0 && !webhook.eventTypes.includes('*') && !webhook.eventTypes.includes('state.changed')) {
        continue;
      }
      // Check scope filter
      if (!matchEvent(eventData, webhook)) continue;

      deliverWebhook(webhook, eventData, 'state.changed').catch(err => {
        console.error(`[Webhooks] Delivery failed for ${webhook.name}:`, err);
      });
    }
  });
}

export function teardownWebhooks(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

// --- CRUD Operations ---

export async function createWebhook(params: {
  name: string;
  url: string;
  eventTypes?: string[];
  homeIds?: string[];
  roomIds?: string[];
  accessoryIds?: string[];
  collectionIds?: string[];
  maxRetries?: number;
  rateLimitPerMinute?: number;
  timeoutMs?: number;
}): Promise<{ webhook: Webhook; rawSecret: string }> {
  const rawSecret = generateWebhookSecret();
  const webhook: Webhook = {
    id: crypto.randomUUID(),
    name: params.name,
    url: params.url,
    secret: rawSecret,
    status: 'active',
    eventTypes: params.eventTypes || ['state.changed'],
    homeIds: params.homeIds || [],
    roomIds: params.roomIds || [],
    accessoryIds: params.accessoryIds || [],
    collectionIds: params.collectionIds || [],
    maxRetries: params.maxRetries ?? 3,
    rateLimitPerMinute: params.rateLimitPerMinute ?? 60,
    timeoutMs: params.timeoutMs ?? 30000,
    consecutiveFailures: 0,
    lastTriggeredAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    createdAt: new Date().toISOString(),
  };
  await db.putWebhook(webhook);
  return { webhook, rawSecret };
}

export async function updateWebhook(
  webhookId: string,
  params: Partial<Pick<Webhook, 'name' | 'url' | 'eventTypes' | 'homeIds' | 'roomIds' | 'accessoryIds' | 'collectionIds' | 'maxRetries' | 'rateLimitPerMinute' | 'timeoutMs'>>,
): Promise<Webhook | null> {
  const webhook = (await db.getWebhook(webhookId)) as Webhook | undefined;
  if (!webhook) return null;
  Object.assign(webhook, params);
  await db.putWebhook(webhook);
  return webhook;
}

export async function deleteWebhookById(webhookId: string): Promise<boolean> {
  await db.deleteWebhook(webhookId);
  await db.deleteWebhookDeliveriesForWebhook(webhookId);
  return true;
}

export async function pauseWebhook(webhookId: string): Promise<Webhook | null> {
  const webhook = (await db.getWebhook(webhookId)) as Webhook | undefined;
  if (!webhook) return null;
  webhook.status = 'paused';
  await db.putWebhook(webhook);
  return webhook;
}

export async function resumeWebhook(webhookId: string): Promise<Webhook | null> {
  const webhook = (await db.getWebhook(webhookId)) as Webhook | undefined;
  if (!webhook) return null;
  webhook.status = 'active';
  webhook.consecutiveFailures = 0;
  await db.putWebhook(webhook);
  return webhook;
}

export async function rotateWebhookSecret(webhookId: string): Promise<{ webhook: Webhook; rawSecret: string } | null> {
  const webhook = (await db.getWebhook(webhookId)) as Webhook | undefined;
  if (!webhook) return null;
  const rawSecret = generateWebhookSecret();
  webhook.secret = rawSecret;
  await db.putWebhook(webhook);
  return { webhook, rawSecret };
}

export async function testWebhook(webhookId: string): Promise<{ success: boolean; statusCode: number | null; responseTimeMs: number | null; error: string | null }> {
  const webhook = (await db.getWebhook(webhookId)) as Webhook | undefined;
  if (!webhook) return { success: false, statusCode: null, responseTimeMs: null, error: 'Webhook not found' };

  const body = JSON.stringify({
    id: `evt_test_${Date.now()}`,
    type: 'webhook.test',
    timestamp: new Date().toISOString(),
    webhook_id: webhook.id,
    data: { test: true },
    metadata: { webhook_version: '1.0', webhook_name: webhook.name },
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signPayload(webhook.secret, body, timestamp);
  const start = performance.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), webhook.timeoutMs);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Homecast-Webhook/1.0',
        'X-Homecast-Signature': signature,
        'X-Homecast-Timestamp': String(timestamp),
        'X-Homecast-Event': 'webhook.test',
        'X-Homecast-Delivery': `test_${crypto.randomUUID()}`,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const responseTimeMs = Math.round(performance.now() - start);

    if (response.ok) {
      return { success: true, statusCode: response.status, responseTimeMs, error: null };
    }
    return { success: false, statusCode: response.status, responseTimeMs, error: `HTTP ${response.status}` };
  } catch (err: any) {
    const responseTimeMs = Math.round(performance.now() - start);
    const error = err.name === 'AbortError' ? 'Request timeout' : err.message || 'Unknown error';
    return { success: false, statusCode: null, responseTimeMs, error };
  }
}

// --- Helpers for GraphQL ---

export function webhookToInfo(webhook: Webhook): Record<string, unknown> {
  return {
    ...webhook,
    secretPrefix: secretPrefix(webhook.secret),
    __typename: 'Webhook',
  };
}
