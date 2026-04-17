/**
 * Diagnostics page — lightweight support view.
 *
 * Shows:
 *   - Current connection state + uptime + client count
 *   - Recent 200 browser-logger entries (WS / GQL / errors)
 *   - "Copy for support" button that serialises the above as JSON so the
 *     user can paste it into a bug report
 *
 * This exists so that when something goes wrong the user can actually see
 * *what* went wrong without the dev having to ask them to open the browser
 * console. The same data is also shipping to Cloud Logging via
 * /internal/logs, but this view is the immediate feedback channel.
 */

import { useEffect, useMemo, useState } from 'react';
import { browserLogger, BrowserLogEntry } from '@/lib/browser-logger';
import { serverConnection, ServerConnectionState } from '@/server/connection';
import { config } from '@/lib/config';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function severityClass(sev: BrowserLogEntry['severity']): string {
  if (sev === 'error') return 'text-red-500';
  if (sev === 'warn') return 'text-amber-500';
  return 'text-muted-foreground';
}

export default function Diagnostics() {
  const [conn, setConn] = useState<ServerConnectionState>(() => serverConnection.getState());
  const [entries, setEntries] = useState<BrowserLogEntry[]>(() => browserLogger.getEntries());
  const [filter, setFilter] = useState<'all' | 'errors' | 'ws' | 'gql'>('all');

  useEffect(() => {
    const unsub = browserLogger.subscribe(() => setEntries(browserLogger.getEntries()));
    return unsub;
  }, []);

  useEffect(() => {
    // Poll every 1s — avoids threading a listener subscription API through
    // serverConnection for this one page; same pattern as RelayStatusBadge.
    const tick = () => setConn(serverConnection.getState());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const slice = entries.slice(-200).reverse();
    if (filter === 'all') return slice;
    if (filter === 'errors') return slice.filter(e => e.severity !== 'info');
    if (filter === 'ws') return slice.filter(e => e.type === 'WS');
    if (filter === 'gql') return slice.filter(e => e.type === 'GQL');
    return slice;
  }, [entries, filter]);

  const handleCopy = async () => {
    const bundle = {
      generatedAt: new Date().toISOString(),
      app: {
        version: config.version,
        apiUrl: config.apiUrl,
        isCommunity: config.isCommunity,
        isStaging: config.isStaging,
      },
      connection: {
        state: conn.connectionState,
        isActive: conn.isActive,
        relayStatus: conn.relayStatus,
        error: conn.error ? String(conn.error) : null,
      },
      userAgent: navigator.userAgent,
      entries: entries.slice(-500),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      toast.success('Diagnostics copied to clipboard');
    } catch {
      toast.error('Copy failed — browser blocked clipboard access');
    }
  };

  const handleClear = () => {
    browserLogger.clear();
    toast.success('Log buffer cleared');
  };

  const handleFlush = () => {
    void browserLogger.flushNow();
    toast.success('Pending logs flushed to server');
  };

  return (
    <div className="container mx-auto max-w-4xl p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Diagnostics</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleFlush}>Flush logs</Button>
          <Button variant="outline" size="sm" onClick={handleClear}>Clear</Button>
          <Button size="sm" onClick={handleCopy}>Copy for support</Button>
        </div>
      </div>

      <section className="rounded-lg border p-4 space-y-2">
        <h2 className="font-medium">Connection</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">State</dt>
          <dd className="font-mono">{conn.connectionState}</dd>
          <dt className="text-muted-foreground">Active</dt>
          <dd className="font-mono">{String(conn.isActive)}</dd>
          <dt className="text-muted-foreground">Relay</dt>
          <dd className="font-mono">{conn.relayStatus === null ? '—' : conn.relayStatus ? 'active' : 'standby'}</dd>
          <dt className="text-muted-foreground">API</dt>
          <dd className="font-mono truncate">{config.apiUrl}</dd>
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono">{config.version}</dd>
          {conn.error ? (
            <>
              <dt className="text-muted-foreground">Error</dt>
              <dd className="font-mono text-red-500">{String(conn.error)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="rounded-lg border">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <h2 className="font-medium">Recent events ({filtered.length})</h2>
          <div className="flex gap-1 text-xs">
            {(['all', 'errors', 'ws', 'gql'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 rounded ${filter === f ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[60vh] overflow-auto font-mono text-xs leading-5">
          {filtered.length === 0 ? (
            <div className="p-4 text-muted-foreground text-center">no entries</div>
          ) : (
            filtered.map(e => (
              <div key={e.id} className="px-4 py-0.5 border-b last:border-b-0 flex gap-3">
                <span className="text-muted-foreground tabular-nums">{formatTimestamp(e.timestamp)}</span>
                <span className={`w-10 ${severityClass(e.severity)}`}>{e.type}</span>
                {e.direction ? <span className="w-3">{e.direction}</span> : <span className="w-3" />}
                <span className={`flex-1 truncate ${severityClass(e.severity)}`} title={e.summary}>{e.summary}</span>
                {e.details ? (
                  <span className="text-muted-foreground truncate max-w-sm" title={e.details}>{e.details}</span>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
