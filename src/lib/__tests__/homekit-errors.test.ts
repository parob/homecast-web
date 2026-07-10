/**
 * HomeKit error translation tests.
 * Mirror of the cloud suite (homecast-cloud server/tests/test_homekit_errors.py)
 * — keep detection rules and wording in sync.
 */

import { describe, it, expect } from 'vitest';
import {
  INSUFFICIENT_HOMEKIT_PRIVILEGES,
  HOMEKIT_EDIT_PERMISSION_MESSAGE,
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
});
