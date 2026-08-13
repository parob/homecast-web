import { describe, it, expect } from 'vitest';
import { formatPrice, getCurrencySymbol } from '../marketplace';

describe('formatPrice', () => {
  it('renders EUR the way its marketplaces do, not as $-style', () => {
    // The old code concatenated a prefixed symbol onto a dot-decimal string,
    // so a German listing printed "€1234.56".
    const out = formatPrice('1234.56', 'EUR');
    expect(out).toContain('€');
    expect(out).not.toBe('€1234.56');
    // German convention: dot groups thousands, comma is the decimal
    expect(out).toContain('1.234,56');
  });

  it('gives whole-number prices their minor units', () => {
    expect(formatPrice('1234', 'GBP')).toBe('£1,234.00');
  });

  it('renders JPY without minor units', () => {
    const out = formatPrice('7640', 'JPY');
    expect(out).toContain('7,640');
    expect(out).not.toContain('.00');
  });

  it('uses the local convention by default — a bare $ on .ca and .com.au', () => {
    // Correct for a single marketplace's own listing page.
    expect(formatPrice('29.99', 'CAD')).toBe(formatPrice('29.99', 'USD'));
  });

  it('disambiguates the dollar currencies when asked', () => {
    // What a mixed-marketplace admin table needs: every deal price in the
    // admin console used to be a hard-coded "$" over a nine-country query.
    expect(formatPrice('29.99', 'CAD', { disambiguate: true })).toContain('CA$');
    expect(formatPrice('29.99', 'AUD', { disambiguate: true })).toContain('A$');
    expect(formatPrice('29.99', 'USD', { disambiguate: true })).toBe('$29.99');
    expect(formatPrice('7640', 'JPY', { disambiguate: true })).toContain('7,640');
  });

  it('degrades rather than throwing on an unknown currency', () => {
    expect(formatPrice('10.00', 'XYZ')).toContain('10');
  });

  it('returns empty for a missing amount instead of "NaN"', () => {
    expect(formatPrice(null, 'GBP')).toBe('');
    expect(formatPrice(undefined, 'GBP')).toBe('');
    expect(formatPrice('', 'GBP')).toBe('');
  });
});

describe('getCurrencySymbol', () => {
  it('covers every marketplace currency', () => {
    for (const c of ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'JPY']) {
      expect(getCurrencySymbol(c)).not.toBe(c);
    }
  });
});
