import { describe, expect, it } from 'vitest';
import {
  excludeValue,
  formatQuery,
  isFacetValueActive,
  parseQuery,
  suggest,
  toFilterInput,
  toggleFacetValue,
} from '../log-query';

describe('parseQuery — structured terms', () => {
  it('splits key:value into a filter and leaves the rest as text', () => {
    const { filters, text } = parseQuery('severity:error relay offline');
    expect(filters).toEqual([
      { field: 'severity', op: 'eq', values: ['ERROR'], negate: false },
    ]);
    expect(text).toBe('relay offline');
  });

  it('ORs repeated terms on the same field, matching the facet checkboxes', () => {
    const { filters } = parseQuery('source:api source:websocket');
    expect(filters).toEqual([
      { field: 'source', op: 'eq', values: ['api', 'websocket'], negate: false },
    ]);
  });

  it('does not merge a repeat that is already present', () => {
    const { filters } = parseQuery('source:api source:api');
    expect(filters[0].values).toEqual(['api']);
  });

  it('keeps a negated term separate from the positive set', () => {
    const { filters } = parseQuery('source:api -source:web');
    expect(filters).toEqual([
      { field: 'source', op: 'eq', values: ['api'], negate: false },
      { field: 'source', op: 'eq', values: ['web'], negate: true },
    ]);
  });

  it('parses comparison operators', () => {
    expect(parseQuery('latency_ms:>500').filters[0]).toEqual({
      field: 'latency_ms', op: 'gt', values: ['500'], negate: false,
    });
    expect(parseQuery('latency_ms:<=100').filters[0].op).toBe('lte');
    expect(parseQuery('message:~timeout').filters[0].op).toBe('contains');
    expect(parseQuery('source:!=web').filters[0].op).toBe('ne');
  });

  it('treats a bare field or a star as an existence check', () => {
    expect(parseQuery('trace_id:*').filters[0]).toEqual({
      field: 'trace_id', op: 'exists', values: [], negate: false,
    });
    expect(parseQuery('-error:*').filters[0]).toEqual({
      field: 'error', op: 'exists', values: [], negate: true,
    });
  });
});

describe('parseQuery — severity', () => {
  it('upper-cases severity values', () => {
    expect(parseQuery('severity:warning').filters[0].values).toEqual(['WARNING']);
  });

  it('expands severity:>= into the matching set', () => {
    // BigQuery stores severity as a plain string, so there is no ordering to
    // compare against — the range has to become an explicit list.
    expect(parseQuery('severity:>=warning').filters[0]).toEqual({
      field: 'severity',
      op: 'eq',
      values: ['WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'],
      negate: false,
    });
  });

  it('excludes the boundary for a strict >', () => {
    expect(parseQuery('severity:>warning').filters[0].values).not.toContain('WARNING');
    expect(parseQuery('severity:>warning').filters[0].values).toContain('ERROR');
  });
});

describe('parseQuery — quoting', () => {
  it('keeps a quoted phrase as one free-text term', () => {
    const { filters, text } = parseQuery('"connection closed"');
    expect(filters).toEqual([]);
    expect(text).toBe('"connection closed"');
  });

  it('keeps a quoted value attached to its field', () => {
    const { filters } = parseQuery('accessory_name:"Living Room Lamp"');
    expect(filters[0]).toEqual({
      field: 'accessory_name', op: 'eq', values: ['Living Room Lamp'], negate: false,
    });
  });

  it('handles a mix of quoted phrases, exclusions and fields', () => {
    const { filters, text } = parseQuery('severity:error "a b" -c d');
    expect(filters[0].field).toBe('severity');
    expect(text).toBe('"a b" -c d');
  });
});

describe('parseQuery — mistakes', () => {
  it('warns on a misspelled field instead of silently matching everything', () => {
    // `sevrity:error` as a filter would be dropped; as free text it returns
    // nothing. Either way the user needs to be told.
    const { warnings, text } = parseQuery('sevrity:error');
    expect(warnings[0]).toContain('sevrity');
    expect(warnings[0]).toContain('severity');
    expect(text).toBe('sevrity:error');
  });

  it('rejects a non-numeric value on a numeric field', () => {
    const { filters, warnings } = parseQuery('latency_ms:slow');
    expect(filters).toEqual([]);
    expect(warnings[0]).toContain('expects a number');
  });

  it('treats a leading colon as text, not an empty field', () => {
    const { filters, text } = parseQuery(':oops');
    expect(filters).toEqual([]);
    expect(text).toBe(':oops');
  });

  it('handles an empty query', () => {
    expect(parseQuery('')).toEqual({ filters: [], text: '', warnings: [] });
  });
});

describe('formatQuery — round trip', () => {
  const cases = [
    'severity:ERROR',
    'source:api source:websocket',
    'source:api -source:web',
    'latency_ms:>500',
    'trace_id:*',
    'severity:ERROR relay offline',
  ];

  it.each(cases)('re-parses to the same filters: %s', (query) => {
    const first = parseQuery(query);
    const second = parseQuery(formatQuery(first.filters, first.text));
    expect(second.filters).toEqual(first.filters);
    expect(second.text).toBe(first.text);
  });

  it('re-quotes a value containing whitespace', () => {
    const { filters } = parseQuery('accessory_name:"Living Room Lamp"');
    expect(formatQuery(filters)).toBe('accessory_name:"Living Room Lamp"');
  });
});

describe('facet toggling', () => {
  it('adds a value to an empty query', () => {
    expect(toggleFacetValue('', 'source', 'api')).toBe('source:api');
  });

  it('adds a second value to the same field', () => {
    expect(toggleFacetValue('source:api', 'source', 'websocket'))
      .toBe('source:api source:websocket');
  });

  it('removes a value that is already selected', () => {
    expect(toggleFacetValue('source:api source:websocket', 'source', 'api'))
      .toBe('source:websocket');
  });

  it('drops the whole filter when the last value is removed', () => {
    expect(toggleFacetValue('source:api', 'source', 'api')).toBe('');
  });

  it('leaves free text alone', () => {
    expect(toggleFacetValue('relay offline', 'source', 'api'))
      .toBe('source:api relay offline');
  });

  it('reports selection state for the checkbox', () => {
    expect(isFacetValueActive('source:api', 'source', 'api')).toBe(true);
    expect(isFacetValueActive('source:api', 'source', 'web')).toBe(false);
    expect(isFacetValueActive('-source:api', 'source', 'api')).toBe(false);
  });

  it('is idempotent when excluding the same value twice', () => {
    const once = excludeValue('', 'source', 'web');
    expect(once).toBe('-source:web');
    expect(excludeValue(once, 'source', 'web')).toBe(once);
  });
});

describe('toFilterInput', () => {
  it('produces the GraphQL wire shape', () => {
    const { filters } = parseQuery('severity:error -source:web');
    expect(toFilterInput(filters)).toEqual([
      { field: 'severity', op: 'eq', values: ['ERROR'], negate: false },
      { field: 'source', op: 'eq', values: ['web'], negate: true },
    ]);
  });
});

describe('suggest', () => {
  it('suggests field names before a colon', () => {
    const { items } = suggest('sev', 3);
    expect(items.map((i) => i.value)).toContain('severity:');
  });

  it('suggests severity values after the colon', () => {
    const { items } = suggest('severity:er', 12);
    expect(items.map((i) => i.value)).toContain('severity:ERROR');
  });

  it('suggests values observed in the current result set', () => {
    const { items } = suggest('source:web', 10, { source: ['web', 'websocket'] });
    expect(items.map((i) => i.value)).toEqual(['source:web', 'source:websocket']);
  });

  it('only replaces the token under the caret', () => {
    const input = 'severity:error sou';
    const { from, to } = suggest(input, input.length);
    expect(input.slice(from, to)).toBe('sou');
  });

  it('skips the leading minus when replacing a negated token', () => {
    const input = '-sou';
    const { from, to, items } = suggest(input, input.length);
    expect(input.slice(from, to)).toBe('sou');
    expect(items.map((i) => i.value)).toContain('source:');
  });

  it('offers the fixed vocabularies', () => {
    expect(suggest('env:', 4).items.map((i) => i.value))
      .toEqual(['env:production', 'env:staging']);
    expect(suggest('success:', 8).items.map((i) => i.value))
      .toEqual(['success:true', 'success:false']);
  });
});
