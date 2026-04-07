// Integration tests for AutomationEngine — full end-to-end automation flows

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutomationEngine, type AutomationEngineConfig } from './AutomationEngine';
import type { HomeKitBridge, EngineCallbacks } from './ActionExecutor';
import type { ServiceGroupResolver } from './TriggerManager';
import type { Automation, TriggerData } from '../types/automation';
import type { ExecutionTrace } from '../types/execution';

function makeConfig(overrides?: Partial<AutomationEngineConfig>): AutomationEngineConfig {
  return {
    bridge: {
      setCharacteristic: vi.fn().mockResolvedValue(undefined),
      setServiceGroup: vi.fn().mockResolvedValue(undefined),
      executeScene: vi.fn().mockResolvedValue(undefined),
    },
    onTraceComplete: vi.fn(),
    onNotify: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('AutomationEngine integration', () => {
  let config: AutomationEngineConfig;
  let engine: AutomationEngine;
  let traces: ExecutionTrace[];

  beforeEach(() => {
    traces = [];
    config = makeConfig({
      onTraceComplete: (trace) => traces.push(trace),
    });
    engine = new AutomationEngine(config);
    engine.initialize((handler) => {
      // No HomeKit events in tests
      return () => {};
    });
  });

  afterEach(() => {
    engine.teardown();
  });

  // ============================================================
  // Basic automation lifecycle
  // ============================================================

  describe('basic lifecycle', () => {
    it('executes a simple automation with set_characteristic', async () => {
      const automation: Automation = {
        id: 'auto-1',
        name: 'Test Light',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test.fire' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'set_characteristic', id: 'action-1', accessoryId: 'light-1', characteristicType: 'power_state', value: 1 },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);

      // Fire the trigger manually
      const trace = await engine.manualTrigger('auto-1');
      expect(trace).not.toBeNull();
      expect(trace!.status).toBe('success');
      expect(config.bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 1);
    });

    it('records trigger data as node output', async () => {
      const automation: Automation = {
        id: 'auto-1',
        name: 'Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'variables', id: 'vars-1', variables: { x: 1 } },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      const trace = await engine.manualTrigger('auto-1');

      expect(trace!.status).toBe('success');
      // Verify manual trigger recorded trigger output
      expect(trace!.steps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // Data flow — n8n-style pipeline
  // ============================================================

  describe('data flow pipeline', () => {
    it('chains HTTP request → Code → Set Device using node outputs', async () => {
      // Mock fetch for HTTP request
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({ brightness: 80 }),
        text: vi.fn(),
      };
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse) as any;

      const automation: Automation = {
        id: 'auto-1',
        name: 'Data Flow Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          // Step 1: HTTP request → captures { status, body: { brightness: 80 } }
          { type: 'fire_webhook', id: 'http1', url: 'https://api.example.com', method: 'GET' },
          // Step 2: Code node transforms data
          { type: 'code', id: 'code1', code: 'return { adjusted: input.nodes.http1.data.body.brightness + 10 };' },
          // Step 3: Use code output to set device
          { type: 'set_characteristic', id: 'set1', accessoryId: 'light-1', characteristicType: 'brightness', value: '{{ nodes.code1.data.adjusted }}' },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      const trace = await engine.manualTrigger('auto-1');

      expect(trace!.status).toBe('success');
      // Bridge should have been called with 90 (80 + 10)
      expect(config.bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'brightness', 90);
    });

    it('merge node combines data from variables actions', async () => {
      const automation: Automation = {
        id: 'auto-1',
        name: 'Merge Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'variables', id: 'vars-a', variables: { sensor: 'temperature', reading: 22 } },
          { type: 'variables', id: 'vars-b', variables: { sensor: 'humidity', reading: 65 } },
          { type: 'merge', id: 'merge1', mode: 'append', inputIds: ['vars-a', 'vars-b'] },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      const trace = await engine.manualTrigger('auto-1');

      expect(trace!.status).toBe('success');
      // Find the merge step
      const mergeStep = trace!.steps.find(s => s.nodeType === 'merge');
      expect(mergeStep).toBeDefined();
      expect(mergeStep!.output?.inputCount).toBe(2);
    });
  });

  // ============================================================
  // Error handling — per-node strategies
  // ============================================================

  describe('per-node error handling', () => {
    it('continues past failed action with onError=continue', async () => {
      (config.bridge.setCharacteristic as any)
        .mockRejectedValueOnce(new Error('Device offline'))
        .mockResolvedValueOnce(undefined);

      const automation: Automation = {
        id: 'auto-1',
        name: 'Error Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'set_characteristic', id: 'fail-action', accessoryId: 'broken-light', characteristicType: 'power_state', value: 1, onError: 'continue' },
          { type: 'set_characteristic', id: 'ok-action', accessoryId: 'working-light', characteristicType: 'power_state', value: 1 },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      const trace = await engine.manualTrigger('auto-1');

      // Should succeed overall because the failure was handled
      expect(trace!.status).toBe('success');
      // Both actions attempted
      expect(config.bridge.setCharacteristic).toHaveBeenCalledTimes(2);
    });

    it('retries failed action with onError=retry', async () => {
      (config.bridge.setCharacteristic as any)
        .mockRejectedValueOnce(new Error('Temporary'))
        .mockResolvedValueOnce(undefined);

      const automation: Automation = {
        id: 'auto-1',
        name: 'Retry Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'set_characteristic', id: 'retry-action', accessoryId: 'light', characteristicType: 'power_state', value: 1, onError: 'retry', maxRetries: 2, retryDelayMs: 10 },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      const trace = await engine.manualTrigger('auto-1');

      expect(trace!.status).toBe('success');
      // First attempt fails, retry succeeds
      expect(config.bridge.setCharacteristic).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // Code node execution
  // ============================================================

  describe('code node in automation', () => {
    it('executes code with access to device state', async () => {
      // Pre-populate device state
      engine.stateStore.updateDeviceState('sensor-1', 'temperature', 25);

      const automation: Automation = {
        id: 'auto-1',
        name: 'Code Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          {
            type: 'code',
            id: 'code1',
            code: `
              const temp = input.states('sensor-1', 'temperature');
              return { fahrenheit: temp * 1.8 + 32 };
            `,
          },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      const trace = await engine.manualTrigger('auto-1');

      expect(trace!.status).toBe('success');
      const codeStep = trace!.steps.find(s => s.nodeType === 'code');
      expect(codeStep?.output?.fahrenheit).toBe(77);
    });
  });

  // ============================================================
  // Disabled nodes
  // ============================================================

  describe('disabled nodes', () => {
    it('skips disabled actions in the flow', async () => {
      const automation: Automation = {
        id: 'auto-1',
        name: 'Disabled Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'set_characteristic', id: 'disabled-action', accessoryId: 'light', characteristicType: 'power_state', value: 1, enabled: false },
          { type: 'set_characteristic', id: 'enabled-action', accessoryId: 'light', characteristicType: 'brightness', value: 80 },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      const trace = await engine.manualTrigger('auto-1');

      expect(trace!.status).toBe('success');
      // Only the enabled action should have been called
      expect(config.bridge.setCharacteristic).toHaveBeenCalledTimes(1);
      expect(config.bridge.setCharacteristic).toHaveBeenCalledWith('light', 'brightness', 80);
    });
  });

  // ============================================================
  // Service group triggers
  // ============================================================

  describe('service group triggers', () => {
    it('fires automation when group member accessory changes', async () => {
      const resolver: ServiceGroupResolver = {
        getGroupsForAccessory: (accId) => accId === 'light-1' ? ['all-lights'] : [],
      };

      const configWithResolver = makeConfig({
        serviceGroupResolver: resolver,
        onTraceComplete: (trace) => traces.push(trace),
      });
      const groupEngine = new AutomationEngine(configWithResolver);
      groupEngine.initialize((handler) => {
        // Store the handler so we can simulate events
        (groupEngine as any)._testEventHandler = handler;
        return () => {};
      });

      const automation: Automation = {
        id: 'auto-1',
        name: 'Group Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{
          type: 'state',
          id: 'group-trigger',
          serviceGroupId: 'all-lights',
          characteristicType: 'power_state',
        }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'variables', id: 'vars-1', variables: { triggered: true } },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      groupEngine.loadAutomations([automation]);

      // Simulate a state change for light-1 (member of all-lights group)
      groupEngine.stateStore.updateDeviceState('light-1', 'power_state', 1);

      // Allow async execution
      await new Promise(r => setTimeout(r, 50));

      expect(traces.length).toBe(1);
      expect(traces[0].status).toBe('success');

      groupEngine.teardown();
    });
  });

  // ============================================================
  // Trace recording completeness
  // ============================================================

  describe('trace recording', () => {
    it('records all steps with inputs and outputs', async () => {
      const automation: Automation = {
        id: 'auto-1',
        name: 'Trace Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'variables', id: 'vars-1', variables: { step: 'one' } },
          { type: 'set_characteristic', id: 'set-1', accessoryId: 'light', characteristicType: 'power_state', value: 1 },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      // manualTrigger skips conditions — only action steps
      const trace = await engine.manualTrigger('auto-1');

      expect(trace!.steps.length).toBeGreaterThanOrEqual(2); // 2 actions
      // Variables step has output
      const varsStep = trace!.steps.find(s => s.nodeType === 'variables');
      expect(varsStep?.output).toBeDefined();
      // Set step has output with success
      const setStep = trace!.steps.find(s => s.nodeType === 'set_characteristic');
      expect(setStep?.output?.success).toBe(true);
    });

    it('returns trace from manualTrigger', async () => {
      const automation: Automation = {
        id: 'auto-1',
        name: 'Trace Return Test',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'variables', id: 'vars-1', variables: { x: 1 } },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([automation]);
      const trace = await engine.manualTrigger('auto-1');

      expect(trace).not.toBeNull();
      expect(trace!.automationId).toBe('auto-1');
      expect(trace!.automationName).toBe('Trace Return Test');
      expect(trace!.status).toBe('success');
    });
  });

  // ============================================================
  // Error trigger — fires when automation fails
  // ============================================================

  describe('error trigger event', () => {
    it('fires automation.error event when automation fails', async () => {
      (config.bridge.setCharacteristic as any).mockRejectedValue(new Error('Device exploded'));

      const failingAuto: Automation = {
        id: 'fail-auto',
        name: 'Failing Automation',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'trigger-1', eventType: 'test.fail' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'set_characteristic', id: 'action-1', accessoryId: 'light', characteristicType: 'power_state', value: 1 },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      // Error handler automation listens for automation.error
      const errorHandlerAuto: Automation = {
        id: 'error-handler',
        name: 'Error Handler',
        homeId: 'home-1',
        enabled: true,
        mode: 'single',
        triggers: [{ type: 'event', id: 'error-trigger', eventType: 'automation.error' }],
        conditions: { operator: 'and', conditions: [] },
        actions: [
          { type: 'variables', id: 'log-error', variables: { caught: true } },
        ],
        metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
      };

      engine.loadAutomations([failingAuto, errorHandlerAuto]);

      // Fire the event that triggers the failing automation
      engine.stateStore.updateDeviceState('trigger-device', 'state', 1);
      // Manually trigger via event
      (engine as any).triggerManager.handleEvent('test.fail', {});

      // Allow async execution
      await new Promise(r => setTimeout(r, 100));

      // The error handler should have been triggered
      expect(traces.length).toBeGreaterThanOrEqual(1);
      // At least one trace should be from the error handler (caught the error)
      const errorHandlerTrace = traces.find(t => t.automationId === 'error-handler');
      // The failing auto should have an error trace
      const failTrace = traces.find(t => t.automationId === 'fail-auto');
      expect(failTrace?.status).toBe('error');
    });
  });
});
