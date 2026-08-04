// Fetch and cache node help markdown from docs.homecast.cloud
// Single source of truth — docs are authored in homecast-cloud/docs/generated/node-help/

import { useState, useEffect } from 'react';

const DOCS_BASE = 'https://docs.homecast.cloud/generated/node-help';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STORAGE_PREFIX = 'node-help:';

// In-memory cache for the current session
const memoryCache = new Map<string, string>();

/** Map nodeType (underscore) to filename (hyphen) */
function nodeTypeToFilename(nodeType: string): string {
  const mapping: Record<string, string> = {
    device_changed: 'device-changed',
    set_device: 'set-device',
    run_scene: 'run-scene',
    http_request: 'http-request',
    sub_workflow: 'sub-workflow',
  };
  return mapping[nodeType] ?? nodeType;
}

interface NodeHelpResult {
  content: string | null;
  loading: boolean;
}

export function useNodeHelp(nodeType: string | null): NodeHelpResult {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!nodeType) {
      setContent(null);
      return;
    }

    // Check memory cache
    const cached = memoryCache.get(nodeType);
    if (cached) {
      setContent(cached);
      return;
    }

    // Check localStorage cache
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + nodeType);
      if (stored) {
        const { content: storedContent, timestamp } = JSON.parse(stored);
        if (Date.now() - timestamp < CACHE_TTL_MS) {
          memoryCache.set(nodeType, storedContent);
          setContent(storedContent);
          return;
        }
      }
    } catch { /* ignore storage errors */ }

    // Fetch from docs site
    let cancelled = false;
    setLoading(true);

    const filename = nodeTypeToFilename(nodeType);
    fetch(`${DOCS_BASE}/${filename}.md`, { signal: AbortSignal.timeout(10_000) })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.text();
      })
      .then((md) => {
        if (cancelled) return;
        memoryCache.set(nodeType, md);
        // Persist to localStorage
        try {
          localStorage.setItem(STORAGE_PREFIX + nodeType, JSON.stringify({ content: md, timestamp: Date.now() }));
        } catch { /* storage full */ }
        setContent(md);
      })
      .catch(() => {
        if (cancelled) return;
        // Fallback to expired localStorage cache if available
        try {
          const stored = localStorage.getItem(STORAGE_PREFIX + nodeType);
          if (stored) {
            setContent(JSON.parse(stored).content);
            return;
          }
        } catch { /* ignore */ }
        setContent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [nodeType]);

  return { content, loading };
}
