// The slug keys REST, MCP and Home Assistant address accessories by.
//
// Lives here rather than in `local-rest` because the relay needs it too, and
// importing it from there dragged the whole server module graph — websocket,
// config, `window` — into code that runs before any of that exists.
//
// One definition, deliberately: `local-mcp` once carried its own copy that
// sanitized punctuation differently, so the slugs `get_state` emitted did not
// resolve in `run_scene` for any home or room with an apostrophe in its name.
// `local-rest` re-exports this, and a test in `server/__tests__/alignment.test.ts`
// holds the line. The cloud's `_unique_key` (api/home.py) must match it.

export function sanitizeName(name: string): string {
  return name.trim().replace(/\s+/g, '_').toLowerCase();
}

export function uniqueKey(name: string, uuid: string): string {
  const shortId = uuid ? uuid.slice(-4).toLowerCase() : '0000';
  return `${sanitizeName(name)}_${shortId}`;
}
