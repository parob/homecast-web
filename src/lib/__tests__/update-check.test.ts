import { describe, it, expect } from 'vitest';
import {
  parseBuildStamp,
  isNewBuild,
  buildToken,
  shouldDeferReload,
  shouldCheckForUpdates,
  guardVerdict,
  type DeferrableDocument,
} from '../update-check';

describe('parseBuildStamp', () => {
  it('reads what a real /version.json carries', () => {
    expect(parseBuildStamp({ version: 'a1b2c3f', deployedAt: '2026-09-09T12:00:00Z' })).toEqual({
      version: 'a1b2c3f',
      deployedAt: '2026-09-09T12:00:00Z',
    });
  });

  it.each([null, undefined, 'not json', 42, [], {}, { version: '' }, { deployedAt: 7 }])(
    'reads %s as no information rather than as a different build',
    (body) => {
      // The distinction matters: a null answer never triggers a reload, while
      // a half-built stamp compared against ours might.
      expect(parseBuildStamp(body)).toBeNull();
    }
  );
});

describe('isNewBuild', () => {
  const running = { version: 'a1b2c3f', deployedAt: '2026-09-09T12:00:00Z' };

  it('sees a deploy', () => {
    expect(isNewBuild(running, { version: 'a1b2c3f', deployedAt: '2026-09-09T13:00:00Z' })).toBe(
      true
    );
  });

  it('sees a rollback, because a withdrawn build is just as wrong to be left on', () => {
    expect(isNewBuild(running, { version: 'a1b2c3f', deployedAt: '2026-09-09T11:00:00Z' })).toBe(
      true
    );
  });

  it('says nothing happened when the stamp is unchanged', () => {
    expect(isNewBuild(running, { ...running })).toBe(false);
  });

  it('ignores version when both sides carry deployedAt', () => {
    // version is homecast-cloud's commit. It moves on a server-only deploy
    // that never rebuilt the web app, and stands still across a web-only one.
    expect(isNewBuild(running, { version: 'ffffff0', deployedAt: running.deployedAt })).toBe(false);
  });

  it('falls back to version only when neither side has a deployedAt', () => {
    expect(isNewBuild({ version: 'a1b2c3f' }, { version: 'ffffff0' })).toBe(true);
    expect(isNewBuild({ version: 'a1b2c3f' }, { version: 'a1b2c3f' })).toBe(false);
  });

  it('will not compare a stamped build against an unstamped one', () => {
    // A build predating VITE_DEPLOY_TIME says nothing about whether the served
    // one differs, and guessing here would reload every tab, every check.
    expect(isNewBuild(running, { version: 'ffffff0' })).toBe(false);
    expect(isNewBuild({ version: 'a1b2c3f' }, running)).toBe(false);
  });

  it('never treats a dev build as something to update to or from', () => {
    expect(isNewBuild({ version: 'dev' }, { version: 'a1b2c3f' })).toBe(false);
    expect(isNewBuild({ version: 'a1b2c3f' }, { version: 'dev' })).toBe(false);
  });

  it('does nothing with no answer at all', () => {
    expect(isNewBuild(running, null)).toBe(false);
  });
});

describe('buildToken', () => {
  it('prefers the stamp that actually changes per deploy', () => {
    expect(buildToken({ version: 'a1b2c3f', deployedAt: 'T' })).toBe('T');
    expect(buildToken({ version: 'a1b2c3f' })).toBe('a1b2c3f');
    expect(buildToken({})).toBe('');
  });
});

describe('shouldCheckForUpdates', () => {
  const stamped = { version: 'a1b2c3f', deployedAt: '2026-09-09T12:00:00Z' };
  const cloudPhone = { dev: false, isCommunity: false, isRelayMac: false, running: stamped };

  it('runs for a cloud client with a stamped build', () => {
    expect(shouldCheckForUpdates(cloudPhone)).toBe(true);
  });

  it('never runs against the dev server', () => {
    expect(shouldCheckForUpdates({ ...cloudPhone, dev: true })).toBe(false);
  });

  it('never runs in Community mode — the bundle cannot change under it', () => {
    expect(shouldCheckForUpdates({ ...cloudPhone, isCommunity: true })).toBe(false);
  });

  it('never reloads the relay Mac on its own', () => {
    // The one place a reload costs something real: the relay socket and the
    // automation engine. Flip this deliberately, not by default.
    expect(shouldCheckForUpdates({ ...cloudPhone, isRelayMac: true })).toBe(false);
  });

  it('has nothing to ask with when the running build carries no stamp', () => {
    expect(shouldCheckForUpdates({ ...cloudPhone, running: {} })).toBe(false);
    expect(shouldCheckForUpdates({ ...cloudPhone, running: { version: 'a1b2c3f' } })).toBe(true);
  });
});

describe('guardVerdict', () => {
  const running = { version: 'a1b2c3f', deployedAt: '2026-09-09T13:00:00Z' };

  it('is unguarded on a fresh session', () => {
    expect(guardVerdict(null, running)).toBe('unguarded');
  });

  it('knows a reload that took', () => {
    expect(guardVerdict('2026-09-09T13:00:00Z', running)).toBe('landed');
  });

  it('knows a reload that did not, and that is the loop breaker', () => {
    // We asked for 13:00, reloaded, and are running 12:00 again. Reloading a
    // second time would produce the same result; stop instead.
    expect(guardVerdict('2026-09-09T13:00:00Z', { ...running, deployedAt: '2026-09-09T12:00:00Z' })).toBe(
      'stuck'
    );
  });
});

describe('shouldDeferReload', () => {
  const doc = (
    overlay: boolean,
    activeElement: DeferrableDocument['activeElement'] = null
  ): DeferrableDocument => ({
    querySelector: () => (overlay ? {} : null),
    activeElement,
  });

  it('waits while a dialog is open', () => {
    expect(shouldDeferReload(doc(true))).toBe(true);
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('waits while a %s has focus', (tagName) => {
    expect(shouldDeferReload(doc(false, { tagName }))).toBe(true);
  });

  it('waits inside a contenteditable', () => {
    expect(shouldDeferReload(doc(false, { tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  it('waits on anything wearing role=textbox', () => {
    expect(
      shouldDeferReload(doc(false, { tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'textbox' : null) }))
    ).toBe(true);
  });

  it('does not wait for a focused button, or for nothing at all', () => {
    expect(shouldDeferReload(doc(false, { tagName: 'BUTTON', getAttribute: () => null }))).toBe(
      false
    );
    expect(shouldDeferReload(doc(false, null))).toBe(false);
    expect(shouldDeferReload(doc(false, { tagName: 'BODY' }))).toBe(false);
  });
});
