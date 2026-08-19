/**
 * The log explorer's query language.
 *
 * One text box drives the whole page, Datadog-style:
 *
 *     severity:error source:websocket -source:web "connection closed"
 *     latency_ms:>500 action:accessories.list env:production
 *     severity:>=warning user_id:c4e0cb24-e0ec-4831-906b-9a35d387aa2e
 *
 * `key:value` terms become structured filters the server turns into SQL
 * predicates; everything left over is free text matched against the message and
 * stack trace. Keeping this pure (no React, no network) is what makes it
 * testable — the parser is the part most likely to develop sharp edges, and the
 * facet sidebar, the URL state and the histogram all round-trip through it.
 *
 * The server holds the authoritative field whitelist; FIELDS below mirrors it so
 * the UI can autocomplete and flag a typo before spending a query on it.
 *
 * Lives here rather than beside the admin page because the @homecast/cloud
 * package has no test runner of its own — pure logic goes in the host app,
 * where vitest already runs, and the cloud page imports it as @/lib/log-query.
 */

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists';

export interface LogFilter {
  field: string;
  op: FilterOp;
  values: string[];
  negate: boolean;
}

export interface ParsedQuery {
  filters: LogFilter[];
  text: string;
  /** Terms that look like a typo'd field, e.g. `sevrity:error`. Advisory only. */
  warnings: string[];
}

/** Mirrors FIELD_EXPR in server/homecast/utils/log_analytics_client.py. */
export const FIELDS = [
  'severity', 'message', 'source', 'logger', 'action', 'span_name', 'trace_id',
  'user_id', 'user_email', 'device_id', 'home_id', 'accessory_id', 'accessory_name',
  'client_type', 'routing_mode', 'slot_name', 'source_slot', 'target_slot',
  'instance_id', 'success', 'error', 'pod_name', 'env', 'log_name', 'latency_ms',
] as const;

export const NUMERIC_FIELDS = new Set(['latency_ms']);

export const SEVERITIES = [
  'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY',
] as const;

const FIELD_SET = new Set<string>(FIELDS);

/**
 * Splits on whitespace but keeps quoted runs whole, so `message:"a b"` and
 * `"connection closed"` survive as single tokens.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Tokenizing loses the quotes, but a quoted free-text phrase has to stay one
 * term when it reaches the server. This re-quotes any residual token containing
 * whitespace.
 */
function requote(token: string): string {
  return /\s/.test(token) ? `"${token}"` : token;
}

const OP_PREFIXES: Array<[string, FilterOp]> = [
  ['>=', 'gte'],
  ['<=', 'lte'],
  ['!=', 'ne'],
  ['>', 'gt'],
  ['<', 'lt'],
  ['~', 'contains'],
];

function parseValue(raw: string): { op: FilterOp; value: string } {
  for (const [prefix, op] of OP_PREFIXES) {
    if (raw.startsWith(prefix)) return { op, value: raw.slice(prefix.length) };
  }
  return { op: 'eq', value: raw };
}

/** Levenshtein distance, capped — only used to suggest a field on a typo. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}

function nearestField(name: string): string | null {
  let best: string | null = null;
  let bestScore = 3;
  for (const f of FIELDS) {
    const d = editDistance(name, f);
    if (d < bestScore) {
      bestScore = d;
      best = f;
    }
  }
  return best;
}

/**
 * Parse a query string into structured filters plus residual free text.
 *
 * Repeated terms on the same field OR together (`source:api source:websocket`
 * means either), which matches how the facet sidebar's checkboxes behave.
 * Negated terms stay separate so `-source:web` reads as an exclusion rather
 * than collapsing into the positive set.
 */
export function parseQuery(input: string): ParsedQuery {
  const filters: LogFilter[] = [];
  const textTerms: string[] = [];
  const warnings: string[] = [];
  // Positive eq-filters on the same field merge; everything else stays discrete.
  const merged = new Map<string, LogFilter>();

  for (const token of tokenize(input || '')) {
    const negate = token.startsWith('-') && token.length > 1;
    const body = negate ? token.slice(1) : token;
    const colon = body.indexOf(':');

    if (colon <= 0) {
      textTerms.push(negate ? `-${requote(body)}` : requote(body));
      continue;
    }

    const field = body.slice(0, colon).toLowerCase();
    const rawValue = body.slice(colon + 1);

    if (!FIELD_SET.has(field)) {
      // Not a known field — treat it as free text rather than silently dropping
      // it, but say so, because `sevrity:error` otherwise returns everything.
      const suggestion = nearestField(field);
      if (suggestion) warnings.push(`Unknown field "${field}" — did you mean "${suggestion}"?`);
      textTerms.push(negate ? `-${requote(body)}` : requote(body));
      continue;
    }

    if (rawValue === '' || rawValue === '*') {
      filters.push({ field, op: 'exists', values: [], negate });
      continue;
    }

    let { op, value } = parseValue(rawValue);

    if (field === 'severity') {
      const upper = value.toUpperCase();
      if (op === 'gte' || op === 'gt') {
        // BigQuery stores severity as a string, so ">= warning" expands into the
        // matching set rather than becoming a comparison.
        const from = SEVERITIES.indexOf(upper as (typeof SEVERITIES)[number]);
        if (from >= 0) {
          const start = op === 'gt' ? from + 1 : from;
          filters.push({ field, op: 'eq', values: [...SEVERITIES.slice(start)], negate });
          continue;
        }
      }
      value = upper;
    }

    if (NUMERIC_FIELDS.has(field) && Number.isNaN(Number(value))) {
      warnings.push(`"${field}" expects a number, got "${value}"`);
      continue;
    }

    if (op === 'eq' && !negate) {
      const existing = merged.get(field);
      if (existing) {
        if (!existing.values.includes(value)) existing.values.push(value);
        continue;
      }
      const filter: LogFilter = { field, op, values: [value], negate };
      merged.set(field, filter);
      filters.push(filter);
      continue;
    }

    filters.push({ field, op, values: [value], negate });
  }

  return { filters, text: textTerms.join(' '), warnings };
}

/** Render one filter back into query-bar syntax. */
export function formatFilter(f: LogFilter): string {
  const prefix = f.negate ? '-' : '';
  if (f.op === 'exists') return `${prefix}${f.field}:*`;
  const opSymbol = ({
    eq: '', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=', contains: '~',
  } as Record<FilterOp, string>)[f.op];
  return f.values
    .map((v) => `${prefix}${f.field}:${opSymbol}${/\s/.test(v) ? `"${v}"` : v}`)
    .join(' ');
}

/** Serialise filters + free text back into a query string. */
export function formatQuery(filters: LogFilter[], text = ''): string {
  return [...filters.map(formatFilter), text].filter(Boolean).join(' ').trim();
}

/**
 * Toggle one facet value in a query string.
 *
 * The facet sidebar edits the query text rather than keeping parallel state, so
 * the box always shows exactly what is being asked — clicking a facet and
 * typing the same thing produce identical queries.
 */
export function toggleFacetValue(query: string, field: string, value: string): string {
  const { filters, text } = parseQuery(query);
  const existing = filters.find((f) => f.field === field && f.op === 'eq' && !f.negate);

  if (!existing) {
    return formatQuery([...filters, { field, op: 'eq', values: [value], negate: false }], text);
  }
  if (existing.values.includes(value)) {
    existing.values = existing.values.filter((v) => v !== value);
    const remaining = existing.values.length ? filters : filters.filter((f) => f !== existing);
    return formatQuery(remaining, text);
  }
  existing.values.push(value);
  return formatQuery(filters, text);
}

/** Is this facet value currently selected? Drives the checkbox state. */
export function isFacetValueActive(query: string, field: string, value: string): boolean {
  return parseQuery(query).filters.some(
    (f) => f.field === field && f.op === 'eq' && !f.negate && f.values.includes(value),
  );
}

/** Add an exclusion, used by the row context menu ("hide this source"). */
export function excludeValue(query: string, field: string, value: string): string {
  const { filters, text } = parseQuery(query);
  const already = filters.some(
    (f) => f.field === field && f.negate && f.values.includes(value),
  );
  if (already) return query;
  return formatQuery([...filters, { field, op: 'eq', values: [value], negate: true }], text);
}

/** Wire format for the GraphQL `filters` argument. */
export function toFilterInput(filters: LogFilter[]) {
  return filters.map((f) => ({
    field: f.field,
    op: f.op,
    values: f.values,
    negate: f.negate,
  }));
}

export interface Suggestion {
  value: string;
  detail?: string;
}

/**
 * Autocomplete for the query bar. Suggests field names until a colon is typed,
 * then values for the fields whose vocabulary is fixed. Facet values observed in
 * the current result set are passed in, so suggestions reflect the data actually
 * present rather than a hardcoded list.
 */
export function suggest(
  input: string,
  caret: number,
  facetValues: Record<string, string[]> = {},
): { from: number; to: number; items: Suggestion[] } {
  const upto = input.slice(0, caret);
  const start = Math.max(upto.lastIndexOf(' ') + 1, 0);
  const token = upto.slice(start);
  const body = token.startsWith('-') ? token.slice(1) : token;
  const offset = token.startsWith('-') ? start + 1 : start;
  const colon = body.indexOf(':');

  if (colon < 0) {
    const items = FIELDS.filter((f) => f.startsWith(body.toLowerCase())).map((value) => ({
      value: `${value}:`,
      detail: NUMERIC_FIELDS.has(value) ? 'number' : undefined,
    }));
    return { from: offset, to: caret, items };
  }

  const field = body.slice(0, colon).toLowerCase();
  const partial = body.slice(colon + 1).toLowerCase();
  const vocabulary = field === 'severity'
    ? [...SEVERITIES]
    : field === 'env'
      ? ['production', 'staging']
      : field === 'success'
        ? ['true', 'false']
        : facetValues[field] || [];

  const items = vocabulary
    .filter((v) => v.toLowerCase().startsWith(partial))
    .slice(0, 20)
    .map((value) => ({ value: `${field}:${value}` }));

  return { from: offset, to: caret, items };
}
