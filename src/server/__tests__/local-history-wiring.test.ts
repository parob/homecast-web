// The history recorder has exactly two inputs, and losing either one is
// silent: HomeKit.onEvent (external changes) and the relay-write publisher
// (this relay's own writes, which HomeKit never re-reports). A refactor that
// drops one keeps the other flowing, every test on the surviving path stays
// green, and users just get charts with unexplained flat stretches.
//
// Same defence relay-write.test.ts uses: read the wiring source and require
// the calls to be present.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'src', rel), 'utf8');

describe('history recorder wiring', () => {
  it('community publisher feeds both callbacks into the recorder', () => {
    const source = read('server/community-automation.ts');
    const publisher = source.slice(source.indexOf('setRelayWritePublisher({'));
    const characteristicCb = publisher.slice(
      publisher.indexOf('characteristic:'),
      publisher.indexOf('serviceGroup:'),
    );
    const groupCb = publisher.slice(publisher.indexOf('serviceGroup:'));

    expect(characteristicCb).toContain('recordHistoryEvent');
    // Group writes must be expanded to members, the same way the engine does.
    expect(groupCb).toContain('getServiceGroupMembers');
    expect(groupCb).toContain('recordHistoryEvent');
  });

  it('the recorder starts with the other community services', () => {
    const source = read('main.tsx');
    expect(source).toContain('initLocalHistory()');
  });

  it('the recorder subscribes to characteristic updates only', () => {
    const source = read('server/local-history.ts');
    const sub = source.slice(source.indexOf('HomeKit.onEvent'));
    expect(sub).toContain("event.type !== 'characteristic.updated'");
  });

  it('cloud-mode relay duties do NOT feed the local recorder', () => {
    // In cloud mode the server records history; a second recorder here would
    // double-store on the Mac and diverge from the account's cloud history.
    const source = read('server/websocket.ts');
    expect(source).not.toContain('recordHistoryEvent');
  });
});
