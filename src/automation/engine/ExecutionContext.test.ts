// Tests for ExecutionContext — node output data flow

import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionContext } from './ExecutionContext';
import type { TriggerData } from '../types/automation';

function makeTriggerData(overrides?: Partial<TriggerData>): TriggerData {
  return {
    triggerId: 'trigger-1',
    triggerType: 'state',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ExecutionContext', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = new ExecutionContext('auto-1', 'Test Automation', makeTriggerData());
  });

  describe('construction', () => {
    it('generates a unique traceId', () => {
      const ctx2 = new ExecutionContext('auto-1', 'Test', makeTriggerData());
      expect(ctx.traceId).toBeTruthy();
      expect(ctx2.traceId).toBeTruthy();
      expect(ctx.traceId).not.toBe(ctx2.traceId);
    });

    it('stores automation metadata', () => {
      expect(ctx.automationId).toBe('auto-1');
      expect(ctx.automationName).toBe('Test Automation');
    });

    it('initializes with empty variables when none provided', () => {
      expect(ctx.variables).toEqual({});
    });

    it('copies initial variables', () => {
      const vars = { count: 0, name: 'test' };
      const ctx2 = new ExecutionContext('auto-1', 'Test', makeTriggerData(), vars);
      expect(ctx2.variables).toEqual({ count: 0, name: 'test' });
      // Verify it's a copy, not a reference
      vars.count = 99;
      expect(ctx2.variables.count).toBe(0);
    });

    it('starts with empty nodeOutputs', () => {
      expect(ctx.nodeOutputs.size).toBe(0);
    });
  });

  // ============================================================
  // Node output data flow (Phase 1)
  // ============================================================

  describe('nodeOutputs', () => {
    it('stores and retrieves node output', () => {
      ctx.setNodeOutput('node-1', { status: 200, body: { ok: true } });
      expect(ctx.getNodeOutput('node-1')).toEqual({ status: 200, body: { ok: true } });
    });

    it('returns undefined for unknown nodes', () => {
      expect(ctx.getNodeOutput('nonexistent')).toBeUndefined();
    });

    it('overwrites previous output for same node', () => {
      ctx.setNodeOutput('node-1', { attempt: 1 });
      ctx.setNodeOutput('node-1', { attempt: 2 });
      expect(ctx.getNodeOutput('node-1')).toEqual({ attempt: 2 });
    });

    it('stores outputs from multiple nodes independently', () => {
      ctx.setNodeOutput('http-1', { status: 200 });
      ctx.setNodeOutput('set-device-1', { success: true });
      ctx.setNodeOutput('if-1', { branch: 'then' });

      expect(ctx.getNodeOutput('http-1')).toEqual({ status: 200 });
      expect(ctx.getNodeOutput('set-device-1')).toEqual({ success: true });
      expect(ctx.getNodeOutput('if-1')).toEqual({ branch: 'then' });
    });

    it('getNodeOutputsForExpressions returns correct format', () => {
      ctx.setNodeOutput('http-1', { status: 200, body: 'ok' });
      ctx.setNodeOutput('trigger-1', { to_value: 1 });

      const expr = ctx.getNodeOutputsForExpressions();
      expect(expr['http-1']).toEqual({ data: { status: 200, body: 'ok' } });
      expect(expr['trigger-1']).toEqual({ data: { to_value: 1 } });
    });

    it('getNodeOutputsForExpressions returns empty object when no outputs', () => {
      expect(ctx.getNodeOutputsForExpressions()).toEqual({});
    });
  });

  // ============================================================
  // Variables
  // ============================================================

  describe('variables', () => {
    it('sets and gets variables', () => {
      ctx.setVariable('count', 42);
      expect(ctx.getVariable('count')).toBe(42);
    });

    it('returns undefined for unset variables', () => {
      expect(ctx.getVariable('missing')).toBeUndefined();
    });
  });

  // ============================================================
  // Abort / cancel
  // ============================================================

  describe('cancellation', () => {
    it('starts not aborted', () => {
      expect(ctx.isAborted).toBe(false);
    });

    it('can be cancelled', () => {
      ctx.cancel();
      expect(ctx.isAborted).toBe(true);
    });
  });

  // ============================================================
  // Trace recording
  // ============================================================

  describe('trace recording', () => {
    it('records steps and builds trace', () => {
      const idx = ctx.beginStep('action', 'node-1', 'set_characteristic', 'Set light');
      ctx.setNodeOutput('node-1', { success: true });
      ctx.endStep(idx, 'executed', { success: true });

      const trace = ctx.buildTrace('success');
      expect(trace.automationId).toBe('auto-1');
      expect(trace.status).toBe('success');
      expect(trace.steps).toHaveLength(1);
      expect(trace.steps[0].nodeId).toBe('node-1');
      expect(trace.steps[0].result).toBe('executed');
      expect(trace.steps[0].output).toEqual({ success: true });
    });

    it('includes nodeOutputs data in trace variables', () => {
      ctx.setVariable('result', 'done');
      const trace = ctx.buildTrace('success');
      expect(trace.variables).toEqual({ result: 'done' });
    });
  });
});
