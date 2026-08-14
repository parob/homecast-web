/**
 * HomeKit error translation tests.
 * Mirror of the cloud suite (homecast-cloud server/tests/test_homekit_errors.py)
 * — keep detection rules and wording in sync.
 */

import { describe, it, expect } from 'vitest';
import {
  INSUFFICIENT_HOMEKIT_PRIVILEGES,
  HOMEKIT_EDIT_PERMISSION_MESSAGE,
  homeViewOnlyMessage,
  homeEditPermissionFix,
  isInsufficientHomeKitPrivileges,
  translateHomeKitError,
} from '@/lib/homekit-errors';

const LEGACY_MESSAGE = 'Automation creation failed: Insufficient privileges.';

describe('isInsufficientHomeKitPrivileges', () => {
  it('matches the new stable code on error objects (HomecastError / native bridge)', () => {
    expect(isInsufficientHomeKitPrivileges({ code: INSUFFICIENT_HOMEKIT_PRIVILEGES, message: 'x' })).toBe(true);
    expect(isInsufficientHomeKitPrivileges({ code: 'AUTOMATION_CREATION_FAILED', message: LEGACY_MESSAGE })).toBe(true);
  });

  it('matches legacy message text on plain Errors (case-insensitive)', () => {
    expect(isInsufficientHomeKitPrivileges(new Error(LEGACY_MESSAGE))).toBe(true);
    expect(isInsufficientHomeKitPrivileges(new Error('INSUFFICIENT PRIVILEGES'))).toBe(true);
    // ApolloError-style: message only
    expect(isInsufficientHomeKitPrivileges({ message: `AUTOMATION_CREATION_FAILED: ${LEGACY_MESSAGE}` })).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isInsufficientHomeKitPrivileges(new Error('Fire date is in the past.'))).toBe(false);
    expect(isInsufficientHomeKitPrivileges({ code: 'NO_DEVICE', message: 'Device not connected' })).toBe(false);
    expect(isInsufficientHomeKitPrivileges(null)).toBe(false);
    expect(isInsufficientHomeKitPrivileges(undefined)).toBe(false);
  });
});

describe('translateHomeKitError', () => {
  it('translates privilege errors to the canonical guidance', () => {
    expect(translateHomeKitError(new Error(LEGACY_MESSAGE))).toBe(HOMEKIT_EDIT_PERMISSION_MESSAGE);
    expect(translateHomeKitError({ code: INSUFFICIENT_HOMEKIT_PRIVILEGES, message: 'x' })).toBe(HOMEKIT_EDIT_PERMISSION_MESSAGE);
  });

  it('keeps unrelated error text', () => {
    expect(translateHomeKitError(new Error('Fire date is in the past.'))).toBe('Fire date is in the past.');
    expect(translateHomeKitError('plain string error')).toBe('plain string error');
  });

  it('names both Apple UI labels in the guidance', () => {
    expect(HOMEKIT_EDIT_PERMISSION_MESSAGE).toContain('Add & Edit Accessories');
    expect(HOMEKIT_EDIT_PERMISSION_MESSAGE).toContain('Allow Editing');
  });

  it('names what the caller was actually trying to change', () => {
    const err = new Error(LEGACY_MESSAGE);
    expect(translateHomeKitError(err, 'scene')).toContain("HomeKit scenes can't be changed");
    expect(translateHomeKitError(err, 'scene')).not.toContain('automations');
    expect(translateHomeKitError(err, 'both')).toContain('HomeKit scenes and automations');
  });

  it('defaults to the automation wording, so existing call sites are unchanged', () => {
    expect(translateHomeKitError(new Error(LEGACY_MESSAGE))).toBe(HOMEKIT_EDIT_PERMISSION_MESSAGE);
    expect(homeViewOnlyMessage()).toBe(HOMEKIT_EDIT_PERMISSION_MESSAGE);
  });
});

describe('homeViewOnlyMessage', () => {
  // The constant is mirrored in the cloud server's homekit_errors.py and in
  // Swift; refactoring it behind a function must not have moved a byte.
  it('keeps the mirrored automation constant byte-identical', () => {
    expect(HOMEKIT_EDIT_PERMISSION_MESSAGE).toBe(
      "The relay's Apple ID has view-only access to this home, so HomeKit automations " +
      'can\'t be changed. In Apple Home → Home Settings, enable "Add & Edit Accessories" ' +
      'for the relay ("Allow Editing" on older iOS and macOS).',
    );
  });

  it('carries the fix in every variant', () => {
    for (const subject of ['automation', 'scene', 'both'] as const) {
      expect(homeViewOnlyMessage(subject)).toContain('Add & Edit Accessories');
      expect(homeViewOnlyMessage(subject)).toContain('Allow Editing');
    }
  });
});

describe('homeEditPermissionFix', () => {
  /**
   * A Cloud Relay is a Homecast-run Apple ID the user invited by email; a
   * self-hosted relay is their own Mac. Naming the wrong one sends them looking
   * for an entry in Home Settings that isn't there.
   */
  it('names Homecast for a Cloud Relay', () => {
    expect(homeEditPermissionFix('cloud')).toContain('the Homecast relay');
    expect(homeEditPermissionFix('cloud')).not.toMatch(/your relay's Apple ID/);
  });

  it('names the user\'s own Apple ID for a self-hosted relay', () => {
    expect(homeEditPermissionFix('self-hosted')).toContain("your relay's Apple ID");
    expect(homeEditPermissionFix('self-hosted')).not.toContain('Homecast');
  });

  // The relay kind rides the WS homes payload, which can still be loading.
  // That must degrade to wording true of both, never to the wrong one.
  it('stays relay-agnostic when the kind is unknown', () => {
    expect(homeEditPermissionFix()).toContain('the relay user');
    expect(homeEditPermissionFix()).not.toContain('Homecast');
    expect(homeEditPermissionFix()).not.toContain("your relay's Apple ID");
  });

  it('keeps the Apple Home path and the setting name in both', () => {
    for (const kind of ['cloud', 'self-hosted'] as const) {
      expect(homeEditPermissionFix(kind)).toContain('Apple Home → Home Settings');
      expect(homeEditPermissionFix(kind)).toContain('Add & Edit Accessories');
    }
  });
});
