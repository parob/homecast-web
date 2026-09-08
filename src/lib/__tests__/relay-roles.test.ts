import { describe, it, expect } from 'vitest';
import { cloudStandbyState, homesServedInsteadOfCloud, parseHomeRoles } from '../relay-roles';

// The production shape on 2026-09-08: three cloud-managed homes, a Mac mini
// serving them, and the user's own MacBook Pro relaying beside it. The server
// keys roles by uppercase stable id; the homes list carries the same ids.
const HC = ['7D9E35CA-0D22-4AA5-9C7F-9B002D9147F9', 'C022D824-BF3D-4DB3-8603-5697E9E57B80', 'D08CB174-3548-4753-9ABE-3D4A13D3326B'];
const homes = HC.map((id, i) => ({ id, name: ['George Street', 'Clitheroe Road', 'County Hall'][i], isCloudManaged: true }));

describe('parseHomeRoles', () => {
  it('keeps only primary and standby, keyed uppercase', () => {
    expect(parseHomeRoles({ [HC[0].toLowerCase()]: 'standby', [HC[1]]: 'primary', [HC[2]]: 'nonsense' }))
      .toEqual({ [HC[0]]: 'standby', [HC[1]]: 'primary' });
  });

  it('is null for anything that is not a map', () => {
    for (const raw of [undefined, null, 'standby', 3, ['primary']]) {
      expect(parseHomeRoles(raw)).toBeNull();
    }
  });
});

describe('cloudStandbyState', () => {
  it('says nothing until the server has said anything', () => {
    // An older server never sends homeRoles; every older presentation stands.
    expect(cloudStandbyState({ relayRoles: null, homes })).toBeNull();
  });

  it('is standby while the cloud relay serves every cloud-managed home', () => {
    const relayRoles = Object.fromEntries(HC.map((id) => [id, 'standby' as const]));
    expect(cloudStandbyState({ relayRoles, homes })).toBe('standby');
  });

  it('is standby for a home the roles map does not mention', () => {
    // Not serving it is the same as standing by, as far as the copy goes.
    expect(cloudStandbyState({ relayRoles: {}, homes })).toBe('standby');
  });

  it('is serving once this Mac holds any cloud-managed home', () => {
    const relayRoles = { [HC[0]]: 'primary' as const, [HC[1]]: 'standby' as const };
    expect(cloudStandbyState({ relayRoles, homes })).toBe('serving');
    expect(homesServedInsteadOfCloud({ relayRoles, homes }).map((h) => h.name)).toEqual(['George Street']);
  });

  it('ignores self-hosted homes entirely', () => {
    const own = [{ id: 'AAAA', name: 'Cabin', isCloudManaged: false }];
    expect(cloudStandbyState({ relayRoles: { AAAA: 'primary' }, homes: own })).toBeNull();
    expect(cloudStandbyState({ relayRoles: { AAAA: 'primary' }, homes: [...own, ...homes] })).toBe('standby');
  });

  it('matches ids case-insensitively', () => {
    const lower = homes.map((h) => ({ ...h, id: h.id.toLowerCase() }));
    expect(cloudStandbyState({ relayRoles: { [HC[0]]: 'primary' }, homes: lower })).toBe('serving');
  });
});
