// Automation Editor - Execution History Panel
// Shows past execution traces with step-by-step inspection.
//
// Everything here renders from the stored trace JSON. Newer traces carry a
// trigger step, per-leaf condition detail, step durations and container tags
// (parentNodeId/branch/iteration) — all optional, so traces recorded before
// those fields existed render exactly as they used to. Entity names are
// resolved at render time from live HomeKit data (entity-labels.ts), which
// humanizes old traces too and keeps the engine free of name lookups.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_EXECUTION_HISTORY } from '@/lib/graphql/queries';
import { subscribeExecutionEvents } from '@/automation/live-execution';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Check, X, Clock, ChevronDown, ChevronRight, BellOff, SkipForward, Loader2,
  RefreshCw, FlaskConical, Ban, Info,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { resolveEntityName, characteristicLabel, characteristicValueLabel } from '../entity-labels';

/** Names for whatever a trace step points at, resolved at render time. */
export interface TraceEntitySource {
  accessories?: { id: string; name: string }[];
  serviceGroups?: { id: string; name: string }[];
  scenes?: { id: string; name: string }[];
}

export const STATUS_STYLES: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  success: { color: 'text-emerald-600', icon: Check, label: 'Success' },
  error: { color: 'text-red-500', icon: X, label: 'Error' },
  stopped: { color: 'text-amber-500', icon: Clock, label: 'Stopped' },
  cancelled: { color: 'text-gray-400', icon: X, label: 'Cancelled' },
  timeout: { color: 'text-amber-500', icon: Clock, label: 'Timeout' },
};

/**
 * One entry per TraceStepResult, each visually distinct. The panel used to
 * collapse all seven onto three icons, so a condition that passed and one
 * that failed looked identical.
 */
export const STEP_RESULT_STYLES: Record<string, { color: string; icon: React.ElementType; label?: string; spin?: boolean }> = {
  executed: { color: 'text-emerald-600', icon: Check },
  passed: { color: 'text-emerald-600', icon: Check },
  failed: { color: 'text-amber-500', icon: X, label: 'Not met' },
  error: { color: 'text-red-500', icon: X, label: 'Error' },
  skipped: { color: 'text-gray-400', icon: SkipForward, label: 'Skipped' },
  timeout: { color: 'text-amber-500', icon: Clock, label: 'Timeout' },
  running: { color: 'text-blue-500', icon: Loader2, spin: true },
};

const BLOCKED_LABELS: Record<string, string> = {
  rate_limit: 'Rate limited',
  mode_single: 'Already running',
  mode_queued: 'Queue full',
  disabled: 'Disabled',
};

/** Parse stored entity dataJson into a trace summary for list display */
export function parseTraceEntity(entity: any): { id: string; status: string; startedAt: string; finishedAt?: string; durationMs?: number; blockedReason?: string; isTest: boolean; parsed: any } | null {
  try {
    const parsed = JSON.parse(entity.dataJson);
    const durationMs = parsed.finishedAt && parsed.startedAt
      ? new Date(parsed.finishedAt).getTime() - new Date(parsed.startedAt).getTime()
      : undefined;
    return {
      id: entity.entityId,
      status: parsed.status ?? 'error',
      startedAt: parsed.startedAt ?? entity.updatedAt,
      finishedAt: parsed.finishedAt,
      durationMs,
      blockedReason: parsed.blockedReason,
      isTest: parsed.triggerData?.eventType === 'manual_trigger',
      parsed,
    };
  } catch { return null; }
}

// ============================================================
// Formatting helpers
// ============================================================

function fmtMs(ms: number | undefined): string | null {
  if (ms == null || Number.isNaN(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function stepDurationMs(step: any): number | undefined {
  if (typeof step.durationMs === 'number') return step.durationMs;
  if (step.startedAt && step.finishedAt) {
    const d = Date.parse(step.finishedAt) - Date.parse(step.startedAt);
    return Number.isNaN(d) ? undefined : d;
  }
  return undefined;
}

function fmtCharValue(value: unknown, characteristicType?: string): string {
  if (value === undefined || value === null || value === '') return '—';
  const label = characteristicValueLabel(characteristicType, value);
  if (label !== '') return label;
  if (typeof value === 'object') {
    try { return JSON.stringify(value).slice(0, 30); } catch { return String(value); }
  }
  return String(value);
}

/**
 * Render-time step summary: replaces raw UUIDs in capture-time summaries with
 * live entity names where the step's input identifies the target. Falls back
 * to the recorded nodeSummary for everything else (and for old traces).
 */
export function humanizeStepSummary(step: any, source?: TraceEntitySource): string {
  const input = step.input ?? {};
  const output = step.output ?? {};

  if (step.type === 'trigger') {
    const accessoryId = input.accessoryId as string | undefined;
    const serviceGroupId = input.serviceGroupId as string | undefined;
    if (accessoryId || serviceGroupId) {
      const name = resolveEntityName(source, { accessoryId, serviceGroupId });
      const char = characteristicLabel(input.characteristicType);
      const from = fmtCharValue(input.fromValue, input.characteristicType);
      const to = fmtCharValue(input.toValue, input.characteristicType);
      return `${name} · ${char} ${from} → ${to}`;
    }
    return step.nodeSummary || 'Trigger';
  }

  switch (step.nodeType) {
    case 'set_characteristic': {
      const accessoryId = (output.accessoryId ?? input.accessoryId) as string | undefined;
      if (!accessoryId) break;
      const charType = (input.characteristicType ?? output.characteristicType) as string | undefined;
      const name = resolveEntityName(source, { accessoryId });
      return `Set ${name} · ${characteristicLabel(charType)} → ${fmtCharValue(output.value ?? input.value, charType)}`;
    }
    case 'set_service_group': {
      const groupId = (input.groupId ?? output.groupId) as string | undefined;
      if (!groupId) break;
      const charType = (input.characteristicType ?? output.characteristicType) as string | undefined;
      const name = resolveEntityName(source, { serviceGroupId: groupId });
      return `Set ${name} · ${characteristicLabel(charType)} → ${fmtCharValue(output.value ?? input.value, charType)}`;
    }
    case 'execute_scene': {
      const sceneId = (input.sceneId ?? output.sceneId) as string | undefined;
      const scene = sceneId ? source?.scenes?.find((s) => s.id === sceneId) : undefined;
      if (scene?.name) return `Scene: ${scene.name}`;
      break;
    }
  }

  return step.nodeSummary || step.nodeType;
}

/** List-row trigger summary: the trigger step's humanized text when present,
    the old triggerData-derived fallback for pre-upgrade traces. */
function triggerSummaryFor(parsed: any, source?: TraceEntitySource): string {
  const first = parsed?.steps?.[0];
  if (first?.type === 'trigger') return humanizeStepSummary(first, source);
  if (parsed?.triggerData?.eventType === 'manual_trigger') return 'Manual test';
  return parsed?.triggerData?.characteristicType ?? '';
}

const UNDELIVERED_LABELS: Record<string, string> = {
  rate_limited: 'Rate limited',
  no_devices: 'No devices',
  preference: 'Turned off',
  error: 'Send failed',
  unknown: 'Unconfirmed',
};

/**
 * A notify step that ran but delivered nothing. The step itself did not fail,
 * so it renders as a success — which is exactly how a user with a working
 * automation and a silent phone ends up believing the notification was sent.
 * Say so on the collapsed row; the reason is otherwise buried in the JSON.
 */
function undeliveredLabel(step: any): string | null {
  if (step.nodeType !== 'notify' || step.result !== 'executed') return null;
  const out = step.output;
  if (!out || out.delivered !== false) return null;
  return UNDELIVERED_LABELS[out.reason as string] ?? 'Not delivered';
}

// ============================================================
// Condition detail tree (actual vs expected per leaf)
// ============================================================

function conditionLeafText(detail: any, source?: TraceEntitySource): string {
  if (detail.accessoryId) {
    const name = resolveEntityName(source, { accessoryId: detail.accessoryId });
    const char = characteristicLabel(detail.characteristicType);
    // Rebuild the description around the resolved name where we can.
    if (detail.type === 'state') {
      return `${name} · ${char} is ${fmtCharValue(detail.expected, detail.characteristicType)}`;
    }
    if (detail.type === 'numeric_state') {
      return `${name} · ${detail.description}`;
    }
  }
  return detail.description ?? detail.type ?? 'Condition';
}

export function ConditionDetailTree({ detail, entitySource, depth = 0 }: { detail: any; entitySource?: TraceEntitySource; depth?: number }) {
  if (!detail || typeof detail !== 'object') return null;
  if (detail.__truncated) {
    return <div className="text-[9px] text-muted-foreground">Condition detail truncated{detail.bytes ? ` (${detail.bytes} bytes)` : ''}</div>;
  }

  const passed = detail.passed === true;
  const isLeaf = detail.kind !== 'block';
  const label = isLeaf ? conditionLeafText(detail, entitySource) : (detail.description ?? detail.operator);

  return (
    <div className={depth > 0 ? 'pl-3' : undefined}>
      <div className="flex items-start gap-1.5 py-0.5">
        <span
          className={cn(
            'mt-[4px] w-1.5 h-1.5 rounded-full shrink-0',
            detail.disabled ? 'bg-gray-300 dark:bg-gray-600' : passed ? 'bg-emerald-500' : 'bg-red-400',
          )}
        />
        <div className="min-w-0 flex-1 leading-tight">
          <span className={cn('text-[10px]', detail.disabled && 'text-muted-foreground line-through')}>{label}</span>
          {isLeaf && !detail.disabled && !detail.error && detail.actual !== undefined && (
            <span className="text-[9px] text-muted-foreground ml-1.5">
              now: {fmtCharValue(detail.actual, detail.characteristicType)}
            </span>
          )}
          {detail.error && <div className="text-[9px] text-red-400">{String(detail.error)}</div>}
        </div>
      </div>
      {Array.isArray(detail.children) &&
        detail.children.map((c: any, i: number) => (
          <ConditionDetailTree key={i} detail={c} entitySource={entitySource} depth={depth + 1} />
        ))}
    </div>
  );
}

// ============================================================
// Step tree (flat steps + parentNodeId tags → nesting at render)
// ============================================================

interface StepNode {
  step: any;
  children: StepNode[];
}

/**
 * Steps are stored flat with parentNodeId tags. A container can run more than
 * once (repeat-inside-repeat), so children attach to the most recent step
 * seen for their parent node. Old traces have no tags and stay flat.
 */
export function buildStepTree(steps: any[]): StepNode[] {
  const roots: StepNode[] = [];
  const lastByNodeId = new Map<string, StepNode>();
  for (const step of steps ?? []) {
    const node: StepNode = { step, children: [] };
    const parent = step.parentNodeId ? lastByNodeId.get(step.parentNodeId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
    lastByNodeId.set(step.nodeId, node);
  }
  return roots;
}

// ============================================================
// Step row
// ============================================================

export function StepRow({ step, entitySource, childNodes }: { step: any; entitySource?: TraceEntitySource; childNodes?: StepNode[] }) {
  const [expanded, setExpanded] = useState(false);
  const status = STEP_RESULT_STYLES[step.result] ?? STEP_RESULT_STYLES.skipped;
  const undelivered = undeliveredLabel(step);
  const StatusIcon = undelivered ? BellOff : (status?.icon ?? Clock);
  const duration = fmtMs(stepDurationMs(step));
  const conditionDetail = step.output?.detail ?? (step.nodeType === 'if_then_else' ? step.input?.condition : undefined);
  const outputSansDetail = useMemo(() => {
    if (!step.output) return undefined;
    if (!conditionDetail || step.output.detail !== conditionDetail) return step.output;
    const { detail: _detail, ...rest } = step.output;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }, [step.output, conditionDetail]);

  const badge = (text: string, tone: 'amber' | 'red' | 'gray' = 'gray') => (
    <span
      className={cn(
        'text-[9px] px-1 rounded shrink-0',
        tone === 'amber' && 'text-amber-600 bg-amber-500/10',
        tone === 'red' && 'text-red-500 bg-red-500/10',
        tone === 'gray' && 'text-muted-foreground bg-muted',
      )}
    >
      {text}
    </span>
  );

  return (
    <div className="border rounded mb-1">
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <StatusIcon className={cn('w-3 h-3 shrink-0', undelivered ? 'text-amber-500' : status?.color ?? 'text-gray-400', status?.spin && 'animate-spin')} />
        <span className="text-[10px] font-medium flex-1 truncate">{humanizeStepSummary(step, entitySource)}</span>
        {undelivered && <span className="text-[9px] text-amber-500 shrink-0">{undelivered}</span>}
        {status?.label && !undelivered && badge(status.label, step.result === 'error' ? 'red' : step.result === 'failed' || step.result === 'timeout' ? 'amber' : 'gray')}
        {step.attempt != null && badge(`try ${step.attempt}`, 'amber')}
        {step.output?.retriesExhausted && badge('retries exhausted', 'red')}
        {step.output?.continued && badge('continued', 'amber')}
        {step.branch != null && badge(String(step.branch))}
        {step.iteration != null && badge(`#${step.iteration + 1}`)}
        {duration && <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">{duration}</span>}
        <span className="text-[9px] text-muted-foreground shrink-0">{step.nodeType}</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {conditionDetail && (
            <div className="bg-muted/40 rounded p-1.5">
              <ConditionDetailTree detail={conditionDetail} entitySource={entitySource} />
            </div>
          )}
          {step.input && Object.keys(step.input).length > 0 && (
            <div>
              <p className="text-[9px] text-muted-foreground">Input</p>
              <pre className="text-[9px] font-mono bg-muted p-1.5 rounded overflow-x-auto max-h-32">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
          )}
          {outputSansDetail && (
            <div>
              <p className="text-[9px] text-muted-foreground">Output</p>
              <pre className="text-[9px] font-mono bg-muted p-1.5 rounded overflow-x-auto max-h-32">
                {JSON.stringify(outputSansDetail, null, 2)}
              </pre>
            </div>
          )}
          {step.error && (
            <div className="text-[9px] text-red-400">{step.error}</div>
          )}
          {step.children?.length > 0 && (
            <div className="pl-2 border-l">
              {step.children.map((child: any, i: number) => (
                <StepRow key={i} step={child} entitySource={entitySource} />
              ))}
            </div>
          )}
        </div>
      )}

      {childNodes && childNodes.length > 0 && (
        <div className="pl-3 pr-1 pb-1 border-l ml-3 mb-1">
          {childNodes.map((child, i) => (
            <StepRow key={i} step={child.step} entitySource={entitySource} childNodes={child.children} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Render a trace's steps as a tree (container tags → nesting). */
export function StepList({ steps, entitySource }: { steps: any[]; entitySource?: TraceEntitySource }) {
  const tree = useMemo(() => buildStepTree(steps), [steps]);
  return (
    <>
      {tree.map((node, i) => (
        <StepRow key={i} step={node.step} entitySource={entitySource} childNodes={node.children} />
      ))}
    </>
  );
}

// ============================================================
// Inline variant for left sidebar embedding
// ============================================================

type StatusFilter = 'all' | 'success' | 'error' | 'stopped';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'success', label: 'OK' },
  { id: 'error', label: 'Errors' },
  { id: 'stopped', label: 'Stopped' },
];

function matchesFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'stopped') return status === 'stopped' || status === 'cancelled' || status === 'timeout';
  return status === filter;
}

export function ExecutionHistoryInline({
  automationId,
  entitySource,
  onSelectTrace,
  followLive,
  onToggleFollowLive,
}: {
  automationId: string;
  entitySource?: TraceEntitySource;
  /** When set, tapping a row hands the parsed trace to the caller (run view
      on the canvas); the row's info button still opens the detail dialog. */
  onSelectTrace?: (parsed: any) => void;
  /** Live-follow toggle state (only meaningful where the engine runs locally). */
  followLive?: boolean;
  onToggleFollowLive?: () => void;
}) {
  const [selectedTrace, setSelectedTrace] = useState<any>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');

  const { data: historyData, loading, refetch } = useQuery(GET_EXECUTION_HISTORY, {
    variables: { automationId, limit: 50 },
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  });

  // A run finishing in this context means a fresh trace just persisted —
  // pick it up without making the user hunt for the refresh button. No-op
  // where the engine runs elsewhere (no events ever fire).
  useEffect(() => {
    return subscribeExecutionEvents(automationId, (e) => {
      if (e.type === 'finished') void refetch();
    });
  }, [automationId, refetch]);

  // Parse once per fetch — this used to re-parse all 50 traces on every render.
  const traces = useMemo(
    () => ((historyData as any)?.hcExecutionTraces ?? []).map(parseTraceEntity).filter(Boolean) as NonNullable<ReturnType<typeof parseTraceEntity>>[],
    [historyData],
  );

  const visible = traces.filter((t) => matchesFilter(t.status, filter));

  return (
    <>
      <div className="px-1.5 pb-1">
        <div className="flex items-center gap-1 px-1 py-1 sticky top-0 bg-background z-10">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={cn(
                'text-[9px] px-1.5 py-0.5 rounded-full font-medium transition-colors',
                filter === f.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          {onToggleFollowLive && (
            <button
              type="button"
              className={cn(
                'ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium transition-colors inline-flex items-center gap-1',
                followLive ? 'bg-blue-500/15 text-blue-500' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={onToggleFollowLive}
              title="Follow new runs live on the canvas"
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', followLive ? 'bg-blue-500 animate-pulse' : 'bg-muted-foreground/40')} />
              Live
            </button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-5 w-5 text-muted-foreground', !onToggleFollowLive && 'ml-auto')}
            onClick={() => refetch()}
            title="Refresh"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          </Button>
        </div>

        {loading && traces.length === 0 && (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">Loading...</div>
        )}

        {!loading && traces.length === 0 && (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">No executions yet</div>
        )}

        {!loading && traces.length > 0 && visible.length === 0 && (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">No matching executions</div>
        )}

        {visible.map((trace) => {
          const status = STATUS_STYLES[trace.status] ?? STATUS_STYLES.error;
          const StatusIcon = trace.blockedReason ? Ban : status.icon;
          const duration = fmtMs(trace.durationMs) ?? '—';
          const startedDate = new Date(trace.startedAt);
          const relative = formatDistanceToNow(startedDate, { addSuffix: true })
            .replace('about ', '').replace('less than a minute ago', 'just now');

          const openDetail = (e: React.MouseEvent) => {
            e.stopPropagation();
            setSelectedTrace(trace);
          };

          return (
            <button
              key={trace.id}
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group"
              onClick={() => (onSelectTrace ? onSelectTrace(trace.parsed) : setSelectedTrace(trace))}
            >
              <div className="flex items-center gap-1.5">
                <StatusIcon className={cn('w-3 h-3 shrink-0', status.color)} />
                <span className="text-[10px] font-medium truncate">
                  {trace.blockedReason ? (BLOCKED_LABELS[trace.blockedReason] ?? 'Blocked') : status.label}
                </span>
                {trace.isTest && (
                  <span className="text-[8px] uppercase tracking-wide text-muted-foreground bg-muted px-1 rounded shrink-0 inline-flex items-center gap-0.5">
                    <FlaskConical className="w-2 h-2" />
                    Test
                  </span>
                )}
                <span className="flex-1" />
                {onSelectTrace && (
                  <span
                    role="button"
                    tabIndex={-1}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                    onClick={openDetail}
                    title="Details"
                  >
                    <Info className="w-3 h-3" />
                  </span>
                )}
                <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">{duration}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 ml-[18px]">
                <span className="text-[9px] text-muted-foreground truncate flex-1">
                  {triggerSummaryFor(trace.parsed, entitySource)}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0" title={startedDate.toLocaleString()}>
                  {relative}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Trace detail dialog */}
      <Dialog open={!!selectedTrace} onOpenChange={(open) => { if (!open) setSelectedTrace(null); }}>
        <DialogContent className="max-w-lg max-h-[80dvh] flex flex-col p-0 gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogTitle className="sr-only">Execution Trace</DialogTitle>
          {selectedTrace && <TraceDetailInline parsed={selectedTrace.parsed} entitySource={entitySource} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TraceDetailInline({ parsed, entitySource }: { parsed: any; entitySource?: TraceEntitySource }) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      {parsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-3 pr-10 border-b space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-medium', STATUS_STYLES[parsed.status]?.color)}>
                {STATUS_STYLES[parsed.status]?.label ?? parsed.status}
              </span>
              {parsed.blockedReason && (
                <span className="text-[10px] text-amber-500">
                  {BLOCKED_LABELS[parsed.blockedReason] ?? parsed.blockedReason}
                </span>
              )}
              {parsed.triggerData?.eventType === 'manual_trigger' && (
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground bg-muted px-1 rounded">Test run</span>
              )}
              {parsed.error && <span className="text-[10px] text-red-400 truncate">{parsed.error}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {triggerSummaryFor(parsed, entitySource)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(parsed.startedAt).toLocaleString()}
              {parsed.finishedAt && ` — ${((new Date(parsed.finishedAt).getTime() - new Date(parsed.startedAt).getTime()) / 1000).toFixed(2)}s`}
            </div>
          </div>

          <div className="p-2">
            <p className="text-[10px] text-muted-foreground px-1 mb-1">Steps ({parsed.steps?.length ?? 0})</p>
            <StepList steps={parsed.steps ?? []} entitySource={entitySource} />
          </div>

          {parsed.variables && Object.keys(parsed.variables).length > 0 && (
            <div className="p-3 border-t">
              <p className="text-[10px] text-muted-foreground mb-1">Final Variables</p>
              <pre className="text-[10px] font-mono bg-muted p-2 rounded overflow-x-auto">
                {JSON.stringify(parsed.variables, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
