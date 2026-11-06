import { useCallback, useEffect, useRef, useState } from 'react';
import { accessoryKey, trackWrite } from '@/lib/pending-writes';

export const MQTT_CONFIRM_TIMEOUT_MS = 30_000;
interface PendingValue { value: unknown; requestId: number; expiresAt: number }
export type PendingTopics = Record<string, Record<string, PendingValue>>;
interface Snapshot { pending: PendingTopics; errors: Record<string, string> }

function objectPayload(payload: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(payload);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function matches(expected: unknown, actual: unknown): boolean {
  if (Object.is(expected, actual)) return true;
  // The two bridges can report HomeKit booleans as either bool or 0/1.
  if (typeof expected === 'boolean' && (actual === 0 || actual === 1)) return Number(expected) === actual;
  if (typeof actual === 'boolean' && (expected === 0 || expected === 1)) return Number(actual) === expected;
  return false;
}

/** Only the display is optimistic; received MQTT messages remain untouched. */
export function pendingPayload(topic: string, payload: string, pending: PendingTopics): string {
  const fields = pending[topic];
  const state = fields && objectPayload(payload);
  if (!state) return payload;
  return JSON.stringify({ ...state, ...Object.fromEntries(Object.entries(fields).map(([key, p]) => [key, p.value])) });
}

/** A broker PUBACK is not a device update. Wait for matching state on the
 * base topic, keeping newer writes safe from old echoes and publish callbacks. */
export function usePendingMqttWrites() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ pending: {}, errors: {} });
  const current = useRef(snapshot);
  const nextId = useRef(0);
  const releases = useRef(new Map<number, () => void>());

  const update = useCallback((change: (s: Snapshot) => Snapshot) => {
    const next = change(current.current);
    if (next === current.current) return;
    current.current = next;
    setSnapshot(next);
    const active = new Set(Object.values(next.pending).flatMap(fields => Object.values(fields).map(p => p.requestId)));
    for (const [id, release] of releases.current) {
      if (!active.has(id)) { release(); releases.current.delete(id); }
    }
  }, []);

  const fail = useCallback((topic: string, requestId: number | undefined, message: string) => {
    update(s => {
      const fields = s.pending[topic] ?? {};
      if (requestId !== undefined && !Object.values(fields).some(p => p.requestId === requestId)) return s;
      const remaining = Object.fromEntries(Object.entries(fields).filter(([, p]) => p.requestId !== requestId));
      const pending = { ...s.pending };
      if (Object.keys(remaining).length) pending[topic] = remaining;
      else delete pending[topic];
      return { pending, errors: { ...s.errors, [topic]: message } };
    });
  }, [update]);

  const begin = useCallback((topic: string, payload: string): number | null => {
    const patch = objectPayload(payload);
    if (!patch || !Object.keys(patch).length) {
      fail(topic, undefined, 'Enter a JSON object with the values to change.');
      return null;
    }
    const requestId = ++nextId.current;
    const expiresAt = Date.now() + MQTT_CONFIRM_TIMEOUT_MS;
    // Use the same icon ring as dashboard controls. This promise settles on
    // state confirmation, failure, supersession or timeout — never on PUBACK.
    const confirmation = new Promise<void>(resolve => releases.current.set(requestId, resolve));
    trackWrite(accessoryKey(topic), confirmation);
    update(s => {
      const fields = { ...s.pending[topic], ...Object.fromEntries(
        Object.entries(patch).map(([key, value]) => [key, { value, requestId, expiresAt }]),
      ) };
      const errors = { ...s.errors };
      delete errors[topic];
      return { pending: { ...s.pending, [topic]: fields }, errors };
    });
    return requestId;
  }, [fail, update]);

  const receive = useCallback((topic: string, payload: string, retained = false) => {
    if (retained || topic.endsWith('/set')) return;
    const state = objectPayload(payload);
    if (!state) return;
    update(s => {
      if (!s.pending[topic] && !s.errors[topic]) return s;
      const fields = { ...s.pending[topic] };
      for (const [key, p] of Object.entries(fields)) {
        // Older bridges report only current state for locks/coverings.
        const fallback = key === 'lock_target' ? 'locked' : key === 'target' ? 'position' : key;
        const actual = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : state[fallback];
        if (matches(p.value, actual)) delete fields[key];
      }
      const pending = { ...s.pending };
      if (Object.keys(fields).length) pending[topic] = fields;
      else delete pending[topic];
      const errors = { ...s.errors };
      delete errors[topic];
      return { pending, errors };
    });
  }, [update]);

  const forget = useCallback((topic: string) => update(s => {
    if (!s.pending[topic] && !s.errors[topic]) return s;
    const pending = { ...s.pending }, errors = { ...s.errors };
    delete pending[topic]; delete errors[topic];
    return { pending, errors };
  }), [update]);

  const disconnect = useCallback(() => update(s => {
    if (!Object.keys(s.pending).length) return s;
    const errors = { ...s.errors };
    for (const topic of Object.keys(s.pending)) errors[topic] = 'Disconnected before the update was confirmed. Showing last reported state.';
    return { pending: {}, errors };
  }), [update]);

  useEffect(() => {
    const expires = Object.values(snapshot.pending).flatMap(fields => Object.values(fields).map(p => p.expiresAt));
    if (!expires.length) return;
    const timer = setTimeout(() => update(s => {
      const pending: PendingTopics = {}, errors = { ...s.errors };
      for (const [topic, fields] of Object.entries(s.pending)) {
        const live = Object.fromEntries(Object.entries(fields).filter(([, p]) => p.expiresAt > Date.now()));
        if (Object.keys(live).length) pending[topic] = live;
        if (Object.keys(live).length !== Object.keys(fields).length) errors[topic] = 'No matching update received. Showing last reported state for unconfirmed changes.';
      }
      return { pending, errors };
    }), Math.max(0, Math.min(...expires) - Date.now()));
    return () => clearTimeout(timer);
  }, [snapshot.pending, update]);

  useEffect(() => () => {
    for (const release of releases.current.values()) release();
    releases.current.clear();
  }, []);

  return { ...snapshot, begin, receive, fail, forget, disconnect };
}
