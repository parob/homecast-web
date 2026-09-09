import { describe, it, expect } from 'vitest';
import { parseHomeRoles } from '../relay-roles';

// The server keys roles by uppercase stable id.
const HC = ['7D9E35CA-0D22-4AA5-9C7F-9B002D9147F9', 'C022D824-BF3D-4DB3-8603-5697E9E57B80', 'D08CB174-3548-4753-9ABE-3D4A13D3326B'];

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
