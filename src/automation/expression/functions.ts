// Homecast Expression Engine - Built-in Functions
// All functions available in expressions: states(), is_state(), now(), min(), max(), etc.

import type { StateStore } from '../state/StateStore';
import type { TriggerData } from '../types/automation';

export interface ExpressionContext {
  stateStore: StateStore;
  triggerData: TriggerData;
  variables: Record<string, unknown>;
  repeat: {
    index: number;
    first: boolean;
    last: boolean;
    item?: unknown;
  };
  wait: {
    completed: boolean;
    trigger?: TriggerData;
  };
}

export type BuiltinFunction = (args: unknown[], ctx: ExpressionContext) => unknown;

/**
 * Registry of all built-in functions available in the expression language.
 */
export function createFunctionRegistry(): Map<string, BuiltinFunction> {
  const fns = new Map<string, BuiltinFunction>();

  // ============================================================
  // State access
  // ============================================================

  // states('accessoryId', 'characteristicType') -> current value
  fns.set('states', (args, ctx) => {
    const [accId, charType] = args as [string, string];
    if (!accId || !charType) return null;
    return ctx.stateStore.getState(accId, charType) ?? null;
  });

  // is_state('accessoryId', 'characteristicType', expectedValue) -> boolean
  fns.set('is_state', (args, ctx) => {
    const [accId, charType, expected] = args as [string, string, unknown];
    if (!accId || !charType) return false;
    const current = ctx.stateStore.getState(accId, charType);
    if (current === expected) return true;
    return String(current) === String(expected);
  });

  // state_attr('accessoryId', 'characteristicType') -> alias for states()
  fns.set('state_attr', (args, ctx) => {
    return fns.get('states')!(args, ctx);
  });

  // last_changed('accessoryId', 'characteristicType') -> seconds since last change
  fns.set('last_changed', (args, ctx) => {
    const [accId, charType] = args as [string, string];
    if (!accId || !charType) return Infinity;
    return ctx.stateStore.getSecondsSinceLastChange(accId, charType);
  });

  // count_changed_within(seconds, ...accessoryId:charType pairs) -> count
  // E.g., count_changed_within(90, 'sensor1', 'motion', 'sensor2', 'motion')
  fns.set('count_changed_within', (args, ctx) => {
    const seconds = Number(args[0]);
    if (isNaN(seconds)) return 0;
    let count = 0;
    for (let i = 1; i < args.length; i += 2) {
      const accId = String(args[i]);
      const charType = String(args[i + 1]);
      if (ctx.stateStore.getSecondsSinceLastChange(accId, charType) <= seconds) {
        count++;
      }
    }
    return count;
  });

  // helper('helperId') -> current helper value
  fns.set('helper', (args, ctx) => {
    const [helperId] = args as [string];
    if (!helperId) return null;
    return ctx.stateStore.getHelperState(helperId) ?? null;
  });

  // ============================================================
  // Date/time
  // ============================================================

  // now() -> returns an object with time properties
  // now().hour, now().minute, now().second, now().weekday, now().year, now().month, now().day
  fns.set('now', () => {
    const d = new Date();
    return {
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      weekday: d.getDay(), // 0=Sun
      year: d.getFullYear(),
      month: d.getMonth() + 1, // 1-based
      day: d.getDate(),
      timestamp: d.getTime() / 1000,
    };
  });

  // today_at('HH:MM') -> timestamp of today at that time
  fns.set('today_at', (args) => {
    const [timeStr] = args as [string];
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    const d = new Date();
    d.setHours(parseInt(parts[0], 10), parseInt(parts[1] ?? '0', 10), parseInt(parts[2] ?? '0', 10), 0);
    return d.getTime() / 1000;
  });

  // ============================================================
  // Math
  // ============================================================

  fns.set('min', (args) => Math.min(...args.map(Number).filter((n) => !isNaN(n))));
  fns.set('max', (args) => Math.max(...args.map(Number).filter((n) => !isNaN(n))));
  fns.set('abs', (args) => Math.abs(Number(args[0])));
  fns.set('round', (args) => {
    const val = Number(args[0]);
    const decimals = args.length > 1 ? Number(args[1]) : 0;
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  });
  fns.set('floor', (args) => Math.floor(Number(args[0])));
  fns.set('ceil', (args) => Math.ceil(Number(args[0])));
  fns.set('sqrt', (args) => Math.sqrt(Number(args[0])));
  fns.set('log', (args) => {
    const val = Number(args[0]);
    const base = args.length > 1 ? Number(args[1]) : Math.E;
    return Math.log(val) / Math.log(base);
  });

  // ============================================================
  // Type conversion
  // ============================================================

  fns.set('int', (args) => {
    const val = Number(args[0]);
    return isNaN(val) ? (args.length > 1 ? args[1] : 0) : Math.trunc(val);
  });

  fns.set('float', (args) => {
    const val = Number(args[0]);
    return isNaN(val) ? (args.length > 1 ? args[1] : 0.0) : val;
  });

  fns.set('str', (args) => String(args[0] ?? ''));

  fns.set('bool', (args) => {
    const v = args[0];
    if (v === false || v === 0 || v === '' || v === null || v === undefined) return false;
    if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
    return true;
  });

  fns.set('is_number', (args) => {
    const v = args[0];
    if (typeof v === 'number') return !isNaN(v);
    if (typeof v === 'string') return !isNaN(Number(v)) && v.trim() !== '';
    return false;
  });

  // ============================================================
  // String
  // ============================================================

  fns.set('len', (args) => {
    const v = args[0];
    if (typeof v === 'string') return v.length;
    if (Array.isArray(v)) return v.length;
    return 0;
  });

  fns.set('upper', (args) => String(args[0] ?? '').toUpperCase());
  fns.set('lower', (args) => String(args[0] ?? '').toLowerCase());
  fns.set('trim', (args) => String(args[0] ?? '').trim());

  fns.set('contains', (args) => {
    const [haystack, needle] = args;
    if (typeof haystack === 'string') return haystack.includes(String(needle));
    if (Array.isArray(haystack)) return haystack.includes(needle);
    return false;
  });

  fns.set('replace', (args) => {
    const [str, old, replacement] = args as [string, string, string];
    return String(str ?? '').split(String(old ?? '')).join(String(replacement ?? ''));
  });

  fns.set('join', (args) => {
    const [arr, sep] = args;
    if (Array.isArray(arr)) return arr.join(String(sep ?? ', '));
    return String(arr ?? '');
  });

  // ============================================================
  // Conditional
  // ============================================================

  // iif(condition, true_value, false_value)
  fns.set('iif', (args) => {
    return args[0] ? args[1] : (args.length > 2 ? args[2] : null);
  });

  // ============================================================
  // Collection
  // ============================================================

  fns.set('range', (args) => {
    const start = args.length > 1 ? Number(args[0]) : 0;
    const end = args.length > 1 ? Number(args[1]) : Number(args[0]);
    const step = args.length > 2 ? Number(args[2]) : 1;
    const result: number[] = [];
    if (step > 0) {
      for (let i = start; i < end && result.length < 1000; i += step) result.push(i);
    } else if (step < 0) {
      for (let i = start; i > end && result.length < 1000; i += step) result.push(i);
    }
    return result;
  });

  return fns;
}
