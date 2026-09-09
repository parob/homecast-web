import { describe, it, expect } from 'vitest';
import { appVersionLabel } from '../app-version';

describe('appVersionLabel', () => {
  it('names the store build number and the commit it was cut from', () => {
    expect(
      appVersionLabel({
        homecastAppVersion: '1.0.5',
        homecastAppBuildNumber: '57',
        homecastAppBuild: '53a6520',
      })
    ).toBe('1.0.5 (57 · 53a6520)');
  });

  it('renders exactly what an app installed before the number existed rendered', () => {
    // The Swift shell only started injecting homecastAppBuildNumber with this
    // change; every build already on a device injects the other two. Their
    // line must not change shape, or a screenshot from an old build reads as
    // a bug in the new web app.
    expect(appVersionLabel({ homecastAppVersion: '1.0.5', homecastAppBuild: '53a6520' })).toBe(
      '1.0.5 (53a6520)'
    );
  });

  it('can name the number without a hash', () => {
    expect(appVersionLabel({ homecastAppVersion: '1.0.5', homecastAppBuildNumber: '57' })).toBe(
      '1.0.5 (57)'
    );
  });

  it('drops the generator placeholder for a checkout with no git', () => {
    expect(
      appVersionLabel({ homecastAppVersion: '1.0.5', homecastAppBuildNumber: '57', homecastAppBuild: 'unknown' })
    ).toBe('1.0.5 (57)');
    expect(appVersionLabel({ homecastAppVersion: '1.0.5', homecastAppBuild: 'unknown' })).toBe('1.0.5');
  });

  it('is nothing at all in a browser', () => {
    expect(appVersionLabel({})).toBeNull();
    expect(appVersionLabel({ homecastAppBuildNumber: '57', homecastAppBuild: '53a6520' })).toBeNull();
  });
});
