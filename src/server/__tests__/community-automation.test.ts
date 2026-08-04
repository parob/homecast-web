/**
 * Coverage for the Community-mode engine bootstrap.
 *
 * This is what makes Homecast automations actually run without a cloud
 * connection — it replaces the server's `automation.sync_all` push with a read
 * from IndexedDB, persists traces locally, and routes notifications to the
 * Mac. It shipped at 0% coverage.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const engine = {
  loadAutomations: vi.fn(),
  loadVirtualAccessories: vi.fn(),
  setLocation: vi.fn(),
};

const initAutomationEngine = vi.fn(async () => engine);
const teardownAutomationEngine = vi.fn();
let currentEngine: typeof engine | null = engine;

const resolverInstance = { start: vi.fn(), stop: vi.fn(), refresh: vi.fn(), getGroupsForAccessory: () => [] };

vi.mock('@/automation', () => ({
  initAutomationEngine: (...a: unknown[]) => initAutomationEngine(...(a as [])),
  teardownAutomationEngine: () => teardownAutomationEngine(),
  getAutomationEngine: () => currentEngine,
  HomeKitServiceGroupResolver: class { constructor() { return resolverInstance; } },
}));

vi.mock('@/automation/relay-adapter', () => ({
  createHomeKitBridgeAdapter: () => ({ setCharacteristic: vi.fn(), setServiceGroup: vi.fn(), executeScene: vi.fn() }),
}));

const resolveHomeLocation = vi.fn(async () => undefined as unknown);
vi.mock('@/automation/location', () => ({
  resolveHomeLocation: (...a: unknown[]) => resolveHomeLocation(...(a as [])),
}));

const showNotification = vi.fn(async () => ({ success: true }));
vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: { onEvent: vi.fn(() => () => {}), showNotification: (...a: unknown[]) => showNotification(...(a as [])) },
  default: { onEvent: vi.fn(() => () => {}), showNotification: (...a: unknown[]) => showNotification(...(a as [])) },
}));

// vi.hoisted, because vi.mock is lifted above the const declarations and this
// factory returns the object eagerly rather than reading it at call time.
const db = vi.hoisted(() => ({
  getHcAutomations: vi.fn(async () => [] as unknown[]),
  getVirtualAccessories: vi.fn(async () => [] as unknown[]),
  getVirtualAccessoryStates: vi.fn(async () => ({} as Record<string, unknown>)),
  saveExecutionTrace: vi.fn(async () => {}),
  saveVirtualAccessoryState: vi.fn(async () => {}),
}));
vi.mock('@/server/local-db', () => db);

import {
  initCommunityAutomationEngine,
  reloadCommunityAutomations,
  teardownCommunityAutomationEngine,
} from '@/server/community-automation';

const automationRow = (id: string, name: string) => ({
  id, homeId: 'home-1', createdAt: '', updatedAt: '',
  data: JSON.stringify({ id, name, enabled: true, triggers: [], actions: [] }),
});

beforeEach(() => {
  vi.clearAllMocks();
  currentEngine = engine;
  db.getHcAutomations.mockResolvedValue([]);
  db.getVirtualAccessories.mockResolvedValue([]);
  db.getVirtualAccessoryStates.mockResolvedValue({});
  resolveHomeLocation.mockResolvedValue(undefined);
});

afterEach(() => {
  teardownCommunityAutomationEngine();
});

describe('initCommunityAutomationEngine', () => {
  it('starts the engine and loads stored automations', async () => {
    db.getHcAutomations.mockResolvedValue([automationRow('a1', 'Evening lights')]);

    await initCommunityAutomationEngine();

    expect(initAutomationEngine).toHaveBeenCalledTimes(1);
    expect(engine.loadAutomations).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a1', name: 'Evening lights' }),
    ]);
  });

  it('loads helpers before automations, since automations may reference them', async () => {
    db.getVirtualAccessories.mockResolvedValue([
      { id: 'h1', homeId: 'home-1', data: JSON.stringify({ id: 'h1', type: 'counter', name: 'Opens' }) },
    ]);
    db.getVirtualAccessoryStates.mockResolvedValue({ h1: 12 });

    await initCommunityAutomationEngine();

    expect(engine.loadVirtualAccessories).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'h1' })],
      { h1: 12 },
    );
    expect(engine.loadVirtualAccessories.mock.invocationCallOrder[0])
      .toBeLessThan(engine.loadAutomations.mock.invocationCallOrder[0]);
  });

  it('skips a corrupt automation row rather than failing the whole load', async () => {
    db.getHcAutomations.mockResolvedValue([
      automationRow('a1', 'Good'),
      { id: 'bad', homeId: 'home-1', data: '{{{not json', createdAt: '', updatedAt: '' },
    ]);

    await initCommunityAutomationEngine();

    expect(engine.loadAutomations).toHaveBeenCalledWith([expect.objectContaining({ id: 'a1' })]);
  });

  it('skips a corrupt helper row', async () => {
    db.getVirtualAccessories.mockResolvedValue([{ id: 'bad', homeId: 'home-1', data: 'nope' }]);

    await initCommunityAutomationEngine();

    expect(engine.loadVirtualAccessories).toHaveBeenCalledWith([], {});
  });

  it('starts the service-group resolver, without which group triggers never fire', async () => {
    await initCommunityAutomationEngine();

    expect(resolverInstance.start).toHaveBeenCalled();
    expect(initAutomationEngine).toHaveBeenCalledWith(
      expect.objectContaining({ serviceGroupResolver: resolverInstance }),
    );
  });

  it('applies the home location once it resolves', async () => {
    resolveHomeLocation.mockResolvedValue({ latitude: 51.5, longitude: -0.12 });

    await initCommunityAutomationEngine();
    await vi.waitFor(() => expect(engine.setLocation).toHaveBeenCalledWith(51.5, -0.12));
  });

  it('does not set a location when none can be resolved', async () => {
    await initCommunityAutomationEngine();
    await new Promise(r => setTimeout(r, 10));

    expect(engine.setLocation).not.toHaveBeenCalled();
  });

  it('is idempotent — concurrent calls share one startup', async () => {
    await Promise.all([initCommunityAutomationEngine(), initCommunityAutomationEngine()]);

    expect(initAutomationEngine).toHaveBeenCalledTimes(1);
  });

  it('routes notifications to the Mac notification centre', async () => {
    await initCommunityAutomationEngine();
    const { onNotify } = initAutomationEngine.mock.calls[0][0] as never as {
      onNotify: (m: string, t?: string, d?: unknown) => Promise<void>;
    };

    await onNotify('Motion detected', 'Alert', { k: 1 });

    expect(showNotification).toHaveBeenCalledWith('Alert', 'Motion detected', { k: 1 });
  });

  it('persists helper state changes so counters survive a restart', async () => {
    await initCommunityAutomationEngine();
    const { onVirtualStateChange } = initAutomationEngine.mock.calls[0][0] as never as {
      onVirtualStateChange: (id: string, v: unknown) => void;
    };

    onVirtualStateChange('door_opens', 3);

    expect(db.saveVirtualAccessoryState).toHaveBeenCalledWith('door_opens', 3);
  });

  it('recovers from a failed startup rather than wedging', async () => {
    initAutomationEngine.mockRejectedValueOnce(new Error('bridge unavailable'));

    await initCommunityAutomationEngine();
    initAutomationEngine.mockResolvedValue(engine);
    await initCommunityAutomationEngine();

    expect(initAutomationEngine).toHaveBeenCalledTimes(2);
  });
});

describe('trace persistence', () => {
  async function captureOnTrace() {
    await initCommunityAutomationEngine();
    return (initAutomationEngine.mock.calls[0][0] as never as {
      onTraceComplete: (t: unknown) => void;
    }).onTraceComplete;
  }

  const trace = (over: Record<string, unknown> = {}) => ({
    id: 'trace-1',
    automationId: 'a1',
    automationName: 'Evening lights',
    status: 'success',
    startedAt: '2026-03-15T10:00:00.000Z',
    finishedAt: '2026-03-15T10:00:02.000Z',
    triggerData: { triggerType: 'state' },
    steps: [],
    variables: {},
    ...over,
  });

  it('stores a completed trace with a computed duration', async () => {
    const onTrace = await captureOnTrace();

    onTrace(trace());
    await vi.waitFor(() => expect(db.saveExecutionTrace).toHaveBeenCalled());

    expect(db.saveExecutionTrace).toHaveBeenCalledWith(expect.objectContaining({
      id: 'trace-1', automationId: 'a1', status: 'success',
      durationMs: 2000, triggerSummary: 'state',
    }));
  });

  it('handles a trace that never finished', async () => {
    const onTrace = await captureOnTrace();

    onTrace(trace({ finishedAt: undefined }));
    await vi.waitFor(() => expect(db.saveExecutionTrace).toHaveBeenCalled());

    expect(db.saveExecutionTrace).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: undefined }),
    );
  });

  it('falls back to "manual" when there is no trigger', async () => {
    const onTrace = await captureOnTrace();

    onTrace(trace({ triggerData: undefined }));
    await vi.waitFor(() => expect(db.saveExecutionTrace).toHaveBeenCalled());

    expect(db.saveExecutionTrace).toHaveBeenCalledWith(
      expect.objectContaining({ triggerSummary: 'manual' }),
    );
  });

  it('swallows a persistence failure rather than breaking the run', async () => {
    db.saveExecutionTrace.mockRejectedValue(new Error('disk full'));
    const onTrace = await captureOnTrace();

    expect(() => onTrace(trace())).not.toThrow();
  });
});

describe('reloadCommunityAutomations', () => {
  it('re-reads automations into the running engine', async () => {
    await initCommunityAutomationEngine();
    db.getHcAutomations.mockResolvedValue([automationRow('a2', 'New one')]);

    await reloadCommunityAutomations();

    expect(engine.loadAutomations).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'a2' }),
    ]);
  });

  it('is a no-op when the engine is not running', async () => {
    currentEngine = null;

    await reloadCommunityAutomations();

    expect(engine.loadAutomations).not.toHaveBeenCalled();
  });

  it('swallows a read failure', async () => {
    await initCommunityAutomationEngine();
    db.getHcAutomations.mockRejectedValue(new Error('db closed'));

    await expect(reloadCommunityAutomations()).resolves.toBeUndefined();
  });
});

describe('teardownCommunityAutomationEngine', () => {
  it('stops the resolver and tears the engine down', async () => {
    await initCommunityAutomationEngine();

    teardownCommunityAutomationEngine();

    expect(resolverInstance.stop).toHaveBeenCalled();
    expect(teardownAutomationEngine).toHaveBeenCalled();
  });

  it('allows a fresh start afterwards', async () => {
    await initCommunityAutomationEngine();
    teardownCommunityAutomationEngine();

    await initCommunityAutomationEngine();

    expect(initAutomationEngine).toHaveBeenCalledTimes(2);
  });
});
