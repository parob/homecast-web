/**
 * HomeKit edit-permission plumbing on the server side.
 *
 * Two things are easy to get wrong here and neither is visible from the UI:
 * scene writes bypassing the error translation that automation writes have
 * (so API and MCP callers see Apple's bare "Insufficient privileges."), and
 * Community mode never resolving GetHomes (so `isAdmin` is permanently
 * undefined and every proactive warning built on it silently never fires).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(),
}));

vi.mock('@/server/local-auth', () => ({
  verifyToken: vi.fn().mockResolvedValue(null),
  verifyTokenFull: vi.fn().mockResolvedValue(null),
  generateCustomToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('@/server/local-db', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/server/connection', () => ({
  communityRequest: vi.fn().mockResolvedValue(null),
}));

import { executeHomeKitAction } from '@/relay/local-handler';
import { executeHomeKitWrite } from '@/server/homekit-write';
import { handleGraphQL } from '@/server/local-graphql';

/** What HomeKit actually returns, before anything translates it. */
const PRIVILEGE_ERROR = new Error('Scene creation failed: Insufficient privileges.');

beforeEach(() => {
  vi.mocked(executeHomeKitAction).mockReset();
});

describe('executeHomeKitWrite', () => {
  it('passes a successful write straight through', async () => {
    vi.mocked(executeHomeKitAction).mockResolvedValue({ id: 'SCENE-1' });

    await expect(executeHomeKitWrite('scene.create', { name: 'Movie' })).resolves.toEqual({ id: 'SCENE-1' });
    expect(executeHomeKitAction).toHaveBeenCalledWith('scene.create', { name: 'Movie' });
  });

  it('names scenes, not automations, when a scene write is refused', async () => {
    vi.mocked(executeHomeKitAction).mockRejectedValue(PRIVILEGE_ERROR);

    await expect(executeHomeKitWrite('scene.create', {})).rejects.toThrow(/HomeKit scenes can't be changed/);
    // Telling someone who just failed to save a scene that "HomeKit automations
    // can't be changed" reads as a misdiagnosis.
    await expect(executeHomeKitWrite('scene.create', {})).rejects.not.toThrow(/automations/);
  });

  it('keeps the automation wording for automation writes', async () => {
    vi.mocked(executeHomeKitAction).mockRejectedValue(PRIVILEGE_ERROR);

    await expect(executeHomeKitWrite('automation.create', {})).rejects.toThrow(/HomeKit automations can't be changed/);
  });

  it('always includes the fix, since an error payload has no tooltip', async () => {
    vi.mocked(executeHomeKitAction).mockRejectedValue(PRIVILEGE_ERROR);

    await expect(executeHomeKitWrite('scene.update', {})).rejects.toThrow(/Add & Edit Accessories/);
    await expect(executeHomeKitWrite('scene.update', {})).rejects.toThrow(/Allow Editing/);
  });

  it('leaves unrelated failures untouched', async () => {
    vi.mocked(executeHomeKitAction).mockRejectedValue(new Error('Fire date is in the past.'));

    await expect(executeHomeKitWrite('scene.create', {})).rejects.toThrow('Fire date is in the past.');
  });
});

describe('GetHomes in Community mode', () => {
  async function getHomes() {
    const res = await handleGraphQL({ operationName: 'GetHomes', variables: {} }) as any;
    return res;
  }

  it('resolves rather than falling through to the unknown-operation branch', async () => {
    vi.mocked(executeHomeKitAction).mockResolvedValue({
      homes: [{ id: 'HOME-1', name: 'County Hall', isPrimary: true, roomCount: 3, accessoryCount: 9, isAdmin: false }],
    });

    const res = await getHomes();
    expect(res.errors).toBeUndefined();
    expect(res.data.homes).toHaveLength(1);
  });

  it('carries isAdmin through, which is the whole point of the resolver', async () => {
    vi.mocked(executeHomeKitAction).mockResolvedValue({
      homes: [{ id: 'HOME-1', name: 'County Hall', isPrimary: true, roomCount: 3, accessoryCount: 9, isAdmin: false }],
    });

    const home = (await getHomes()).data.homes[0];
    expect(home.isAdmin).toBe(false);
    expect(home.id).toBe('HOME-1');
    expect(home.name).toBe('County Hall');
    // Homecast's sharing role, not a HomeKit one — the relay never sends it.
    expect(home.role).toBe('owner');
  });

  it('reports an old relay as unknown, never as restricted', async () => {
    vi.mocked(executeHomeKitAction).mockResolvedValue({
      homes: [{ id: 'HOME-1', name: 'County Hall', isPrimary: true, roomCount: 3, accessoryCount: 9 }],
    });

    // null, not false: `isAdmin === false` is what gates the warnings, and a
    // relay that can't report access must not be treated as view-only.
    expect((await getHomes()).data.homes[0].isAdmin).toBeNull();
  });

  it('returns an empty list rather than throwing when the bridge is down', async () => {
    vi.mocked(executeHomeKitAction).mockRejectedValue(new Error('No device connected'));

    expect((await getHomes()).data.homes).toEqual([]);
  });
});
