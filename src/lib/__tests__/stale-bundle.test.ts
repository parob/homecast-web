import { describe, it, expect } from 'vitest';
import { isStaleBundleError } from '../stale-bundle';

describe('isStaleBundleError', () => {
  // The messages three engines actually produce for the same cause: a lazy
  // import of a chunk a deploy renamed away. Verbatim, because there is no
  // error code to key on and the wording is the whole signal.
  it.each([
    ['Chrome', 'Failed to fetch dynamically imported module: https://homecast.cloud/assets/DealPriceChart-BBgncQ6Q.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
    ['Vite preload', 'Unable to preload CSS for /assets/Dashboard-TXodn9Nu.css'],
  ])('recognises the %s wording', (_engine, message) => {
    expect(isStaleBundleError(new Error(message))).toBe(true);
  });

  it('accepts a bare string, since not every rejection carries an Error', () => {
    expect(isStaleBundleError('Failed to fetch dynamically imported module: /assets/x.js')).toBe(true);
  });

  it('reads an Error-shaped object that did not survive a structured clone', () => {
    expect(isStaleBundleError({ message: 'Failed to fetch dynamically imported module' })).toBe(true);
  });

  it('leaves real bugs alone — they must keep reaching the crash screen', () => {
    expect(isStaleBundleError(new Error("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isStaleBundleError(new Error('Failed to fetch'))).toBe(false);
    expect(isStaleBundleError(new TypeError('x is not a function'))).toBe(false);
  });

  it('survives the things an error path really gets handed', () => {
    expect(isStaleBundleError(undefined)).toBe(false);
    expect(isStaleBundleError(null)).toBe(false);
    expect(isStaleBundleError('')).toBe(false);
    expect(isStaleBundleError({})).toBe(false);
    expect(isStaleBundleError({ message: 42 })).toBe(false);
  });
});
