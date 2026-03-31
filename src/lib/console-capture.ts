/**
 * Captures console.log/info/warn/error/debug output into a circular buffer
 * for display in the admin panel's Logs tab.
 */

export interface CapturedLogEntry {
  id: string;
  timestamp: string;
  message: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  source?: string;
}

type LogListener = (entry: CapturedLogEntry) => void;

const MAX_ENTRIES = 500;
const buffer: CapturedLogEntry[] = [];
const listeners = new Set<LogListener>();
let nextId = 1;
let initialized = false;

function serializeArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function extractSource(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  // Skip: Error, extractSource, capture wrapper, console.X override
  const lines = stack.split('\n');
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip internal frames
    if (line.includes('console-capture') || line.includes('node_modules')) continue;
    const match = line.match(/(?:at\s+)?(?:.*?\s+\()?(.+?)(?:\))?$/);
    if (match) return match[1];
  }
  return undefined;
}

function capture(level: CapturedLogEntry['level'], args: unknown[]) {
  const entry: CapturedLogEntry = {
    id: String(nextId++),
    timestamp: new Date().toISOString(),
    message: serializeArgs(args),
    level,
    source: extractSource(),
  };

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }

  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // Don't let listener errors cause recursion
    }
  }
}

export function initConsoleCapture() {
  if (initialized) return;
  initialized = true;

  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;

  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      capture(level, args);
    };
  }
}

export function getConsoleLogs(): CapturedLogEntry[] {
  return [...buffer];
}

export function clearConsoleLogs() {
  buffer.length = 0;
}

export function onConsoleLog(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
