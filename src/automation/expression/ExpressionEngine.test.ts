// Tests for ExpressionEngine — node output references and template resolution

import { describe, it, expect, beforeEach } from 'vitest';
import { ExpressionEngine } from './ExpressionEngine';
import type { ExpressionContext } from './functions';
import { StateStore } from '../state/StateStore';
import type { TriggerData } from '../types/automation';

function makeContext(overrides?: Partial<ExpressionContext>): ExpressionContext {
  const stateStore = new StateStore();
  return {
    stateStore,
    triggerData: {
      triggerId: 'trigger-1',
      triggerType: 'state',
      fromValue: 0,
      toValue: 1,
      accessoryId: 'acc-1',
      characteristicType: 'power_state',
      timestamp: 1000,
    },
    variables: {},
    repeat: { index: 0, first: true, last: true },
    wait: { completed: false },
    ...overrides,
  };
}

describe('ExpressionEngine', () => {
  let engine: ExpressionEngine;

  beforeEach(() => {
    engine = new ExpressionEngine();
  });

  // ============================================================
  // Basic expressions (sanity checks)
  // ============================================================

  describe('basic expressions', () => {
    it('evaluates numbers', () => {
      expect(engine.evaluate('42', makeContext())).toBe(42);
    });

    it('evaluates strings', () => {
      expect(engine.evaluate("'hello'", makeContext())).toBe('hello');
    });

    it('evaluates arithmetic', () => {
      expect(engine.evaluate('2 + 3 * 4', makeContext())).toBe(14);
    });

    it('evaluates boolean logic', () => {
      expect(engine.evaluate('true && false', makeContext())).toBe(false);
      expect(engine.evaluate('true || false', makeContext())).toBe(true);
    });

    it('evaluates comparisons', () => {
      expect(engine.evaluate('10 > 5', makeContext())).toBe(true);
      expect(engine.evaluate('10 < 5', makeContext())).toBe(false);
    });

    it('evaluates ternary', () => {
      expect(engine.evaluate('true ? 1 : 0', makeContext())).toBe(1);
      expect(engine.evaluate('false ? 1 : 0', makeContext())).toBe(0);
    });
  });

  // ============================================================
  // Trigger data access
  // ============================================================

  describe('trigger data access', () => {
    it('accesses trigger.from_value', () => {
      const ctx = makeContext({
        triggerData: {
          triggerId: 't1',
          triggerType: 'state',
          fromValue: 0,
          toValue: 1,
          timestamp: 1000,
        },
      });
      expect(engine.evaluate('trigger.from_value', ctx)).toBe(0);
      expect(engine.evaluate('trigger.to_value', ctx)).toBe(1);
    });

    it('accesses trigger.accessory_id', () => {
      const ctx = makeContext();
      expect(engine.evaluate('trigger.accessory_id', ctx)).toBe('acc-1');
    });
  });

  // ============================================================
  // Variable access
  // ============================================================

  describe('variable access', () => {
    it('reads variables', () => {
      const ctx = makeContext({ variables: { count: 42, name: 'test' } });
      expect(engine.evaluate('count', ctx)).toBe(42);
      expect(engine.evaluate('name', ctx)).toBe('test');
    });

    it('accesses variables via variables. prefix', () => {
      const ctx = makeContext({ variables: { count: 42 } });
      expect(engine.evaluate('variables.count', ctx)).toBe(42);
    });
  });

  // ============================================================
  // Node output access (Phase 1 — data flow)
  // ============================================================

  describe('node output access (data flow)', () => {
    it('accesses node output via nodes.<id>.data.<field> (simple IDs)', () => {
      const ctx = makeContext({
        nodes: {
          http1: { data: { status: 200, body: { temperature: 22.5 } } },
          set1: { data: { success: true, value: 80 } },
        },
      });

      expect(engine.evaluate('nodes.http1.data.status', ctx)).toBe(200);
      expect(engine.evaluate('nodes.set1.data.success', ctx)).toBe(true);
    });

    it('accesses node output via bracket notation (IDs with hyphens)', () => {
      const ctx = makeContext({
        nodes: {
          'http-1': { data: { status: 200 } },
        },
      });

      // IDs with hyphens require bracket notation since - is subtraction
      expect(engine.evaluate("nodes['http-1'].data.status", ctx)).toBe(200);
    });

    it('accesses nested node output data', () => {
      const ctx = makeContext({
        nodes: {
          http1: { data: { body: { weather: { temp: 22, unit: 'C' } } } },
        },
      });

      expect(engine.evaluate('nodes.http1.data.body.weather.temp', ctx)).toBe(22);
      expect(engine.evaluate('nodes.http1.data.body.weather.unit', ctx)).toBe('C');
    });

    it('returns undefined for missing node property', () => {
      const ctx = makeContext({ nodes: {} });
      const result = engine.evaluate('nodes.nonexistent', ctx);
      expect(result).toBeUndefined();
    });

    it('returns empty object when nodes not set', () => {
      const ctx = makeContext({ nodes: undefined });
      expect(engine.evaluate('nodes', ctx)).toEqual({});
    });

    it('compares node output in conditions', () => {
      const ctx = makeContext({
        nodes: {
          http1: { data: { status: 200 } },
        },
      });

      expect(engine.evaluateBoolean('nodes.http1.data.status == 200', ctx)).toBe(true);
      expect(engine.evaluateBoolean('nodes.http1.data.status == 404', ctx)).toBe(false);
      expect(engine.evaluateBoolean('nodes.http1.data.status > 199', ctx)).toBe(true);
    });

    it('uses node output in arithmetic', () => {
      const ctx = makeContext({
        nodes: {
          sensor1: { data: { to_value: 22 } },
        },
      });

      expect(engine.evaluate('nodes.sensor1.data.to_value * 1.8 + 32', ctx)).toBeCloseTo(71.6);
    });
  });

  // ============================================================
  // Template resolution
  // ============================================================

  describe('template resolution', () => {
    it('resolves full template to raw value', () => {
      const ctx = makeContext({
        nodes: {
          http1: { data: { body: { brightness: 75 } } },
        },
      });

      // Full template — returns raw value (number, not string)
      const result = engine.resolveTemplate('{{ nodes.http1.data.body.brightness }}', ctx);
      expect(result).toBe(75);
    });

    it('resolves partial template with interpolation', () => {
      const ctx = makeContext({
        nodes: {
          http1: { data: { status: 200 } },
        },
      });

      const result = engine.resolveTemplate('HTTP status: {{ nodes.http1.data.status }}', ctx);
      expect(result).toBe('HTTP status: 200');
    });

    it('passes through non-template strings', () => {
      expect(engine.resolveTemplate('hello world', makeContext())).toBe('hello world');
    });

    it('passes through non-string values', () => {
      expect(engine.resolveTemplate(42, makeContext())).toBe(42);
      expect(engine.resolveTemplate(true, makeContext())).toBe(true);
    });

    it('resolves trigger data in templates', () => {
      const ctx = makeContext();
      expect(engine.resolveTemplate('{{ trigger.to_value }}', ctx)).toBe(1);
    });

    it('resolves variables in templates', () => {
      const ctx = makeContext({ variables: { name: 'Living Room' } });
      expect(engine.resolveTemplate('{{ name }}', ctx)).toBe('Living Room');
    });
  });

  // ============================================================
  // Built-in functions
  // ============================================================

  describe('built-in functions', () => {
    it('states() reads device state', () => {
      const stateStore = new StateStore();
      stateStore.updateDeviceState('acc-1', 'brightness', 80);
      const ctx = makeContext({ stateStore });

      expect(engine.evaluate("states('acc-1', 'brightness')", ctx)).toBe(80);
    });

    it('is_state() checks equality', () => {
      const stateStore = new StateStore();
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      const ctx = makeContext({ stateStore });

      expect(engine.evaluateBoolean("is_state('acc-1', 'power_state', 1)", ctx)).toBe(true);
      expect(engine.evaluateBoolean("is_state('acc-1', 'power_state', 0)", ctx)).toBe(false);
    });

    it('now() returns time properties', () => {
      const ctx = makeContext();
      const result = engine.evaluate('now()', ctx) as Record<string, number>;
      expect(result).toHaveProperty('hour');
      expect(result).toHaveProperty('minute');
      expect(result).toHaveProperty('weekday');
    });

    it('min/max work', () => {
      expect(engine.evaluate('min(5, 3, 8)', makeContext())).toBe(3);
      expect(engine.evaluate('max(5, 3, 8)', makeContext())).toBe(8);
    });

    it('iif() conditional', () => {
      expect(engine.evaluate("iif(true, 'yes', 'no')", makeContext())).toBe('yes');
      expect(engine.evaluate("iif(false, 'yes', 'no')", makeContext())).toBe('no');
    });

    it('string functions', () => {
      expect(engine.evaluate("upper('hello')", makeContext())).toBe('HELLO');
      expect(engine.evaluate("lower('HELLO')", makeContext())).toBe('hello');
      expect(engine.evaluate("contains('hello world', 'world')", makeContext())).toBe(true);
    });
  });

  // ============================================================
  // evaluateBoolean
  // ============================================================

  describe('depth limit', () => {
    it('throws on deeply nested member access', () => {
      let expr = 'a';
      for (let i = 0; i < 200; i++) expr += '.a';
      const ctx = makeContext({ variables: { a: { a: { a: {} } } } });
      expect(() => engine.evaluate(expr, ctx)).toThrow(/nesting depth/i);
    });

    it('throws on deeply nested index access', () => {
      let expr = 'v';
      for (let i = 0; i < 200; i++) expr += '[0]';
      const ctx = makeContext({ variables: { v: [0] } });
      expect(() => engine.evaluate(expr, ctx)).toThrow(/nesting depth/i);
    });

    it('evaluates normally-deep expressions', () => {
      const ctx = makeContext({ variables: { v: { a: { b: { c: 42 } } } } });
      expect(engine.evaluate('v.a.b.c', ctx)).toBe(42);
    });
  });

  describe('evaluateBoolean', () => {
    it('truthy values', () => {
      const ctx = makeContext();
      expect(engine.evaluateBoolean('1', ctx)).toBe(true);
      expect(engine.evaluateBoolean("'hello'", ctx)).toBe(true);
      expect(engine.evaluateBoolean('true', ctx)).toBe(true);
    });

    it('falsy values', () => {
      const ctx = makeContext();
      expect(engine.evaluateBoolean('0', ctx)).toBe(false);
      expect(engine.evaluateBoolean("''", ctx)).toBe(false);
      expect(engine.evaluateBoolean('false', ctx)).toBe(false);
      expect(engine.evaluateBoolean("'false'", ctx)).toBe(false);
    });
  });
});
