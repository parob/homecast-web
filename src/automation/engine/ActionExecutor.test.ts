// Tests for ActionExecutor — node output capture and data flow

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActionExecutor, type HomeKitBridge, type EngineCallbacks } from './ActionExecutor';
import { ExecutionContext } from './ExecutionContext';
import { ConditionEvaluator } from './ConditionEvaluator';
import { StateStore } from '../state/StateStore';
import type { TriggerData, Action } from '../types/automation';

function makeTriggerData(overrides?: Partial<TriggerData>): TriggerData {
  return {
    triggerId: 'trigger-1',
    triggerType: 'state',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeCtx(vars?: Record<string, unknown>): ExecutionContext {
  return new ExecutionContext('auto-1', 'Test', makeTriggerData(), vars);
}

describe('ActionExecutor', () => {
  let stateStore: StateStore;
  let conditionEvaluator: ConditionEvaluator;
  let bridge: HomeKitBridge;
  let callbacks: EngineCallbacks;
  let executor: ActionExecutor;

  beforeEach(() => {
    stateStore = new StateStore();
    conditionEvaluator = new ConditionEvaluator(stateStore);
    bridge = {
      setCharacteristic: vi.fn().mockResolvedValue(undefined),
      setServiceGroup: vi.fn().mockResolvedValue(undefined),
      executeScene: vi.fn().mockResolvedValue(undefined),
    };
    callbacks = {
      fireEvent: vi.fn(),
      sendNotification: vi.fn().mockResolvedValue(undefined),
      setAutomationEnabled: vi.fn(),
      triggerAutomation: vi.fn().mockResolvedValue(undefined),
      executeScript: vi.fn().mockResolvedValue({ result: 'ok' }),
      registerTemporaryTrigger: vi.fn().mockReturnValue(() => {}),
    };
    executor = new ActionExecutor(stateStore, conditionEvaluator, bridge, callbacks);
  });

  // ============================================================
  // Node output capture (Phase 1 — data flow)
  // ============================================================

  describe('set_characteristic output', () => {
    it('captures output with success', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'set_characteristic',
        id: 'node-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('node-1');
      expect(output).toEqual({
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
        success: true,
      });
    });

    it('captures error output on failure', async () => {
      (bridge.setCharacteristic as any).mockRejectedValue(new Error('Device offline'));
      const ctx = makeCtx();
      const action: Action = {
        type: 'set_characteristic',
        id: 'node-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
      };

      await expect(executor.executeSequence([action], ctx)).rejects.toThrow('Device offline');

      const output = ctx.getNodeOutput('node-1');
      expect(output?.success).toBe(false);
      expect(output?.error).toContain('Device offline');
    });
  });

  describe('set_service_group output', () => {
    it('captures output with success', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'set_service_group',
        id: 'node-2',
        groupId: 'group-1',
        characteristicType: 'power_state',
        value: 1,
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('node-2');
      expect(output).toEqual({
        groupId: 'group-1',
        characteristicType: 'power_state',
        value: 1,
        success: true,
      });
    });
  });

  describe('execute_scene output', () => {
    it('captures output', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'execute_scene',
        id: 'node-3',
        sceneId: 'scene-1',
      };

      await executor.executeSequence([action], ctx);

      expect(ctx.getNodeOutput('node-3')).toEqual({
        sceneId: 'scene-1',
        success: true,
      });
    });
  });

  describe('fire_webhook output', () => {
    it('captures HTTP response including body', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ temperature: 22.5 }),
        text: vi.fn().mockResolvedValue(''),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;

      const ctx = makeCtx();
      const action: Action = {
        type: 'fire_webhook',
        id: 'http-1',
        url: 'https://api.example.com/data',
        method: 'GET',
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('http-1');
      expect(output?.status).toBe(200);
      expect(output?.ok).toBe(true);
      expect(output?.body).toEqual({ temperature: 22.5 });
    });

    it('captures text response for non-JSON', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: vi.fn(),
        text: vi.fn().mockResolvedValue('Hello world'),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;

      const ctx = makeCtx();
      const action: Action = {
        type: 'fire_webhook',
        id: 'http-2',
        url: 'https://example.com',
      };

      await executor.executeSequence([action], ctx);

      expect(ctx.getNodeOutput('http-2')?.body).toBe('Hello world');
    });

    it('captures error on network failure without throwing', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;

      const ctx = makeCtx();
      const action: Action = {
        type: 'fire_webhook',
        id: 'http-3',
        url: 'https://unreachable.example.com',
      };

      // Should NOT throw — webhook failures don't stop the automation
      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('http-3');
      expect(output?.status).toBe(0);
      expect(output?.ok).toBe(false);
      expect(output?.error).toContain('Network error');
    });
  });

  describe('variables output', () => {
    it('captures set variables as output', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'variables',
        id: 'vars-1',
        variables: { count: 42, name: 'test' },
      };

      await executor.executeSequence([action], ctx);

      expect(ctx.getNodeOutput('vars-1')).toEqual({ count: 42, name: 'test' });
      expect(ctx.getVariable('count')).toBe(42);
    });
  });

  describe('if_then_else output', () => {
    it('captures branch taken', async () => {
      stateStore.updateDeviceState('acc-1', 'power_state', 1);
      const ctx = makeCtx();

      const action: Action = {
        type: 'if_then_else',
        id: 'if-1',
        condition: {
          operator: 'and',
          conditions: [{
            type: 'state',
            accessoryId: 'acc-1',
            characteristicType: 'power_state',
            value: 1,
          }],
        },
        then: [],
        else: [],
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('if-1');
      expect(output?.branch).toBe('then');
      expect(output?.result).toBe(true);
    });
  });

  describe('delay output', () => {
    it('captures duration', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'delay',
        id: 'delay-1',
        duration: { seconds: 0 }, // 0ms for test speed
      };

      await executor.executeSequence([action], ctx);

      expect(ctx.getNodeOutput('delay-1')).toEqual({ durationMs: 0 });
    });
  });

  describe('fire_event output', () => {
    it('captures event info', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'fire_event',
        id: 'event-1',
        eventType: 'custom.alarm',
        eventData: { level: 'high' },
      };

      await executor.executeSequence([action], ctx);

      expect(ctx.getNodeOutput('event-1')).toEqual({
        eventType: 'custom.alarm',
        eventData: { level: 'high' },
      });
    });
  });

  describe('notify output', () => {
    it('captures notification info', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'notify',
        id: 'notify-1',
        message: 'Light is on',
        title: 'Alert',
      };

      await executor.executeSequence([action], ctx);

      expect(ctx.getNodeOutput('notify-1')).toEqual({
        message: 'Light is on',
        title: 'Alert',
        success: true,
      });
    });
  });

  describe('call_script output', () => {
    it('captures script response', async () => {
      (callbacks.executeScript as any).mockResolvedValue({ status: 'completed', data: [1, 2, 3] });
      const ctx = makeCtx();
      const action: Action = {
        type: 'call_script',
        id: 'script-1',
        scriptId: 'my-script',
      };

      await executor.executeSequence([action], ctx);

      expect(ctx.getNodeOutput('script-1')).toEqual({
        response: { status: 'completed', data: [1, 2, 3] },
        scriptId: 'my-script',
      });
    });
  });

  // ============================================================
  // Data flow between nodes (Phase 1 — n8n-style)
  // ============================================================

  describe('data flow between nodes', () => {
    it('downstream action can reference upstream output via template', async () => {
      // Mock fetch for HTTP request
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ brightness: 75 }),
        text: vi.fn(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;

      const ctx = makeCtx();

      // First: HTTP request
      const httpAction: Action = {
        type: 'fire_webhook',
        id: 'http-1',
        url: 'https://api.example.com/brightness',
        method: 'GET',
      };

      // Second: Set device using HTTP response via template
      // Note: bracket notation needed for IDs with hyphens since - is subtraction
      const setAction: Action = {
        type: 'set_characteristic',
        id: 'set-1',
        accessoryId: 'acc-1',
        characteristicType: 'brightness',
        value: "{{ nodes['http-1'].data.body.brightness }}",
      };

      await executor.executeSequence([httpAction, setAction], ctx);

      // Verify the bridge was called with the resolved value from HTTP response
      expect(bridge.setCharacteristic).toHaveBeenCalledWith('acc-1', 'brightness', 75);
    });

    it('multiple nodes accumulate outputs for downstream use', async () => {
      const ctx = makeCtx();

      // Set some variables
      const varsAction: Action = {
        type: 'variables',
        id: 'vars-1',
        variables: { target: 'acc-2' },
      };

      // Set a device
      const setAction: Action = {
        type: 'set_characteristic',
        id: 'set-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
      };

      await executor.executeSequence([varsAction, setAction], ctx);

      // Both nodes have outputs
      expect(ctx.getNodeOutput('vars-1')).toBeDefined();
      expect(ctx.getNodeOutput('set-1')).toBeDefined();
      expect(ctx.nodeOutputs.size).toBe(2);
    });
  });

  // ============================================================
  // Disabled actions
  // ============================================================

  describe('disabled actions', () => {
    it('skips disabled actions', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'set_characteristic',
        id: 'node-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
        enabled: false,
      };

      await executor.executeSequence([action], ctx);

      expect(bridge.setCharacteristic).not.toHaveBeenCalled();
      expect(ctx.getNodeOutput('node-1')).toBeUndefined();
    });
  });

  // ============================================================
  // Per-node error handling (Phase 3)
  // ============================================================

  // ============================================================
  // Code/Function node (Phase 5)
  // ============================================================

  describe('code action', () => {
    it('executes JavaScript and captures return value', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'code',
        id: 'code-1',
        code: 'return { doubled: input.trigger.toValue * 2 };',
      };

      // Set trigger data toValue
      const ctxWithTrigger = new ExecutionContext('auto-1', 'Test', makeTriggerData({ toValue: 21 }));
      await executor.executeSequence([action], ctxWithTrigger);

      expect(ctxWithTrigger.getNodeOutput('code-1')).toEqual({ doubled: 42 });
    });

    it('can access upstream node outputs', async () => {
      const ctx = makeCtx();
      ctx.setNodeOutput('prev-node', { value: 10 });

      const action: Action = {
        type: 'code',
        id: 'code-1',
        code: 'return { result: input.nodes.prev_node ? "found" : "not_found" };',
      };

      await executor.executeSequence([action], ctx);
      expect(ctx.getNodeOutput('code-1')).toBeDefined();
    });

    it('returns primitive values wrapped in result', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'code',
        id: 'code-1',
        code: 'return 42;',
      };

      await executor.executeSequence([action], ctx);
      expect(ctx.getNodeOutput('code-1')).toEqual({ result: 42 });
    });

    it('throws on syntax error', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'code',
        id: 'code-1',
        code: 'return {{{invalid;',
      };

      await expect(executor.executeSequence([action], ctx)).rejects.toThrow();
    });

    it('captures error output on failure', async () => {
      const ctx = makeCtx();
      const action: Action = {
        type: 'code',
        id: 'code-1',
        code: 'throw new Error("custom error");',
      };

      await expect(executor.executeSequence([action], ctx)).rejects.toThrow('custom error');
      expect(ctx.getNodeOutput('code-1')?.error).toBe(true);
    });

    it('can use variables from context', async () => {
      const ctx = makeCtx({ myVar: 'hello' });
      const action: Action = {
        type: 'code',
        id: 'code-1',
        code: 'return { greeting: input.variables.myVar + " world" };',
      };

      await executor.executeSequence([action], ctx);
      expect(ctx.getNodeOutput('code-1')).toEqual({ greeting: 'hello world' });
    });

    it('can query device state via states function', async () => {
      stateStore.updateDeviceState('acc-1', 'brightness', 75);
      const ctx = makeCtx();
      const action: Action = {
        type: 'code',
        id: 'code-1',
        code: 'return { brightness: input.states("acc-1", "brightness") };',
      };

      await executor.executeSequence([action], ctx);
      expect(ctx.getNodeOutput('code-1')).toEqual({ brightness: 75 });
    });
  });

  // ============================================================
  // Merge node (Phase 4)
  // ============================================================

  describe('merge action', () => {
    it('appends outputs from multiple nodes', async () => {
      const ctx = makeCtx();
      ctx.setNodeOutput('branch-a', { value: 'hello' });
      ctx.setNodeOutput('branch-b', { value: 'world' });

      const action: Action = {
        type: 'merge',
        id: 'merge-1',
        mode: 'append',
        inputIds: ['branch-a', 'branch-b'],
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('merge-1');
      expect(output?.merged).toEqual([
        { value: 'hello' },
        { value: 'world' },
      ]);
      expect(output?.inputCount).toBe(2);
    });

    it('combines objects by merging fields', async () => {
      const ctx = makeCtx();
      ctx.setNodeOutput('branch-a', { name: 'Light', brightness: 80 });
      ctx.setNodeOutput('branch-b', { color: 'warm', temperature: 3000 });

      const action: Action = {
        type: 'merge',
        id: 'merge-1',
        mode: 'combine',
        inputIds: ['branch-a', 'branch-b'],
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('merge-1');
      expect(output?.merged).toEqual({
        name: 'Light',
        brightness: 80,
        color: 'warm',
        temperature: 3000,
      });
    });

    it('handles missing input nodes gracefully', async () => {
      const ctx = makeCtx();
      ctx.setNodeOutput('branch-a', { value: 'exists' });
      // branch-b has no output

      const action: Action = {
        type: 'merge',
        id: 'merge-1',
        mode: 'append',
        inputIds: ['branch-a', 'branch-b'],
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('merge-1');
      expect(output?.inputCount).toBe(1);
      expect(output?.merged).toEqual([{ value: 'exists' }]);
    });

    it('wait_all mode collects all available inputs', async () => {
      const ctx = makeCtx();
      ctx.setNodeOutput('a', { status: 200 });
      ctx.setNodeOutput('b', { status: 201 });
      ctx.setNodeOutput('c', { status: 202 });

      const action: Action = {
        type: 'merge',
        id: 'merge-1',
        mode: 'wait_all',
        inputIds: ['a', 'b', 'c'],
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('merge-1');
      expect(output?.inputCount).toBe(3);
    });
  });

  describe('error handling: onError=stop (default)', () => {
    it('propagates errors by default', async () => {
      (bridge.setCharacteristic as any).mockRejectedValue(new Error('Device offline'));
      const ctx = makeCtx();
      const action: Action = {
        type: 'set_characteristic',
        id: 'node-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
      };

      await expect(executor.executeSequence([action], ctx)).rejects.toThrow('Device offline');
    });

    it('does not execute subsequent actions after error', async () => {
      (bridge.setCharacteristic as any).mockRejectedValue(new Error('Fail'));
      const ctx = makeCtx();
      const actions: Action[] = [
        { type: 'set_characteristic', id: 'fail', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1 },
        { type: 'set_characteristic', id: 'should-not-run', accessoryId: 'acc-2', characteristicType: 'power_state', value: 1 },
      ];

      await expect(executor.executeSequence(actions, ctx)).rejects.toThrow();
      expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling: onError=continue', () => {
    it('continues to next action after error', async () => {
      (bridge.setCharacteristic as any)
        .mockRejectedValueOnce(new Error('Device offline'))
        .mockResolvedValueOnce(undefined);

      const ctx = makeCtx();
      const actions: Action[] = [
        { type: 'set_characteristic', id: 'fail', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1, onError: 'continue' },
        { type: 'set_characteristic', id: 'success', accessoryId: 'acc-2', characteristicType: 'power_state', value: 1 },
      ];

      // Should NOT throw
      await executor.executeSequence(actions, ctx);

      // Both actions were attempted
      expect(bridge.setCharacteristic).toHaveBeenCalledTimes(2);

      // Failed action has error in output
      const failOutput = ctx.getNodeOutput('fail');
      expect(failOutput?.error).toBe(true);
      expect(failOutput?.errorMessage).toContain('Device offline');

      // Successful action has normal output
      expect(ctx.getNodeOutput('success')?.success).toBe(true);
    });

    it('records error info in node output', async () => {
      (bridge.setCharacteristic as any).mockRejectedValue(new Error('Timeout'));
      const ctx = makeCtx();
      const action: Action = {
        type: 'set_characteristic',
        id: 'node-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
        onError: 'continue',
      };

      await executor.executeSequence([action], ctx);

      const output = ctx.getNodeOutput('node-1');
      expect(output?.error).toBe(true);
      expect(output?.errorMessage).toContain('Timeout');
    });
  });

  describe('error handling: onError=retry', () => {
    it('retries on failure and succeeds', async () => {
      (bridge.setCharacteristic as any)
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce(undefined);

      const ctx = makeCtx();
      const action: Action = {
        type: 'set_characteristic',
        id: 'node-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
        onError: 'retry',
        maxRetries: 3,
        retryDelayMs: 10, // Fast for testing
      };

      await executor.executeSequence([action], ctx);

      // Called twice: first attempt fails, second succeeds
      expect(bridge.setCharacteristic).toHaveBeenCalledTimes(2);
      expect(ctx.getNodeOutput('node-1')?.success).toBe(true);
    });

    it('exhausts retries and continues without throwing', async () => {
      (bridge.setCharacteristic as any).mockRejectedValue(new Error('Persistent error'));

      const ctx = makeCtx();
      const action: Action = {
        type: 'set_characteristic',
        id: 'node-1',
        accessoryId: 'acc-1',
        characteristicType: 'power_state',
        value: 1,
        onError: 'retry',
        maxRetries: 2,
        retryDelayMs: 10,
      };

      // Should NOT throw even after exhausting retries
      await executor.executeSequence([action], ctx);

      // 1 initial + 2 retries = 3 attempts
      expect(bridge.setCharacteristic).toHaveBeenCalledTimes(3);

      const output = ctx.getNodeOutput('node-1');
      expect(output?.error).toBe(true);
      expect(output?.retryCount).toBe(2);
    });

    it('proceeds to next action after retry exhaustion', async () => {
      (bridge.setCharacteristic as any)
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValueOnce(undefined); // This is the NEXT action

      const ctx = makeCtx();
      const actions: Action[] = [
        { type: 'set_characteristic', id: 'retry-fail', accessoryId: 'acc-1', characteristicType: 'power_state', value: 1, onError: 'retry', maxRetries: 1, retryDelayMs: 10 },
        { type: 'set_characteristic', id: 'next-action', accessoryId: 'acc-2', characteristicType: 'power_state', value: 1 },
      ];

      await executor.executeSequence(actions, ctx);

      // retry-fail: 1 initial + 1 retry = 2, then next-action: 1
      expect(bridge.setCharacteristic).toHaveBeenCalledTimes(3);
      expect(ctx.getNodeOutput('retry-fail')?.error).toBe(true);
      expect(ctx.getNodeOutput('next-action')?.success).toBe(true);
    });
  });
});
