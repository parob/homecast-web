// Homecast Automation Engine - Trace summary helpers
//
// Pure functions used while recording execution traces. Deliberately free of
// engine/DOM imports so the serialization tests and any node-side consumer can
// use them. Names are NOT resolved here — the engine has no name cache, and
// looking names up at render time keeps old traces humanized too.

import type { Trigger, TriggerData, Duration } from '../types/automation';

/** Cap applied to values folded into a trace step (webhook bodies, code IO,
    condition trees). A single chatty webhook response must not balloon the
    stored trace — the full value still flows to downstream nodes untouched. */
export const TRACE_FIELD_MAX_BYTES = 8192;

/**
 * Bound a value's JSON size before it enters a trace. Oversize values become
 * `{ __truncated: true, bytes, preview }`; everything else passes through.
 */
export function capLarge(value: unknown, maxJsonBytes = TRACE_FIELD_MAX_BYTES): unknown {
  if (value === undefined || value === null) return value;
  let json: string;
  try {
    json = JSON.stringify(value) ?? '';
  } catch {
    // Circular or otherwise unstringifiable — a preview is all the trace gets.
    return { __truncated: true, preview: String(value).slice(0, 500) };
  }
  if (json.length <= maxJsonBytes) return value;
  return { __truncated: true, bytes: json.length, preview: json.slice(0, 500) };
}

function fmtValue(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'object') {
    try { return JSON.stringify(v).slice(0, 40); } catch { return String(v); }
  }
  return String(v);
}

function fmtOffset(d?: Duration): string {
  if (!d) return '';
  const parts: string[] = [];
  if (d.hours) parts.push(`${d.hours}h`);
  if (d.minutes) parts.push(`${d.minutes}m`);
  if (d.seconds) parts.push(`${d.seconds}s`);
  if (parts.length === 0) return '';
  return ` +${parts.join(' ')}`;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtWeekdays(weekdays?: number[]): string {
  if (!weekdays || weekdays.length === 0 || weekdays.length === 7) return '';
  return ` (${weekdays.map((d) => WEEKDAY_NAMES[d] ?? String(d)).join(', ')})`;
}

/**
 * One-line description of what fired an automation, recorded as the trigger
 * step's summary. Ids stay raw (see module note); state values are included
 * because they are the fact users open the history to find.
 */
export function describeTriggerData(data: TriggerData, trigger?: Trigger): string {
  if (data.eventType === 'manual_trigger') return 'Manual test';

  switch (data.triggerType) {
    case 'state':
    case 'numeric_state': {
      const target = data.serviceGroupId ? 'Group' : 'Device';
      const char = data.characteristicType ?? 'state';
      return `${target} changed: ${char} ${fmtValue(data.fromValue)} → ${fmtValue(data.toValue)}`;
    }
    case 'time': {
      const at = trigger?.type === 'time' ? trigger.at : undefined;
      const days = trigger?.type === 'time' ? fmtWeekdays(trigger.weekdays) : '';
      return at ? `Time: ${at}${days}` : 'Scheduled time';
    }
    case 'time_pattern': {
      if (trigger?.type === 'time_pattern') {
        const parts: string[] = [];
        if (trigger.hours) parts.push(`h=${trigger.hours}`);
        if (trigger.minutes) parts.push(`m=${trigger.minutes}`);
        if (trigger.seconds) parts.push(`s=${trigger.seconds}`);
        if (parts.length > 0) return `Time pattern: ${parts.join(' ')}`;
      }
      return 'Time pattern';
    }
    case 'sun': {
      if (trigger?.type === 'sun') {
        const event = trigger.event === 'sunrise' ? 'Sunrise' : 'Sunset';
        return `${event}${fmtOffset(trigger.offset)}`;
      }
      return 'Sun event';
    }
    case 'webhook':
      return 'Webhook received';
    case 'event':
      return data.eventType ? `Event: ${data.eventType}` : 'Event';
    case 'system':
      return trigger?.type === 'system' ? `System: ${trigger.event}` : 'System event';
    case 'template':
      return 'Expression became true';
    case 'device_availability': {
      const to = trigger?.type === 'device_availability' ? trigger.to : data.toValue;
      return to === 'available' ? 'Device came online' : 'Device went offline';
    }
    default:
      return data.triggerType ?? 'Trigger';
  }
}
