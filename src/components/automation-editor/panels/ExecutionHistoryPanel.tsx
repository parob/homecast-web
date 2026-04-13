// Automation Editor - Execution History Panel
// Shows past execution traces with step-by-step inspection

import { useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_EXECUTION_HISTORY } from '@/lib/graphql/queries';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, X, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExecutionHistoryPanelProps {
  automationId: string;
  onClose: () => void;
}

export const STATUS_STYLES: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  success: { color: 'text-emerald-600', icon: Check, label: 'Success' },
  error: { color: 'text-red-500', icon: X, label: 'Error' },
  stopped: { color: 'text-amber-500', icon: Clock, label: 'Stopped' },
  cancelled: { color: 'text-gray-400', icon: X, label: 'Cancelled' },
  timeout: { color: 'text-amber-500', icon: Clock, label: 'Timeout' },
};

/** Parse stored entity dataJson into a trace summary for list display */
function parseTraceEntity(entity: any): { id: string; status: string; startedAt: string; finishedAt?: string; durationMs?: number; triggerSummary?: string; parsed: any } | null {
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
      triggerSummary: parsed.triggerData?.eventType === 'manual_trigger' ? 'Manual test' : parsed.triggerData?.characteristicType,
      parsed,
    };
  } catch { return null; }
}

export function ExecutionHistoryPanel({ automationId, onClose }: ExecutionHistoryPanelProps) {
  const [selectedTrace, setSelectedTrace] = useState<any>(null);

  const { data: historyData, loading } = useQuery(GET_EXECUTION_HISTORY, {
    variables: { automationId, limit: 50 },
    fetchPolicy: 'network-only',
  });

  const traces = (historyData?.hcExecutionTraces ?? []).map(parseTraceEntity).filter(Boolean) as ReturnType<typeof parseTraceEntity>[];

  if (selectedTrace) {
    return <TraceDetail parsed={selectedTrace.parsed} onBack={() => setSelectedTrace(null)} />;
  }

  return (
    <div className="w-full sm:w-80 border-l flex flex-col min-h-0 h-full shrink-0 bg-background">
      <div className="h-12 border-b flex items-center gap-2 px-3 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium flex-1">Executions</span>
        <span className="text-[10px] text-muted-foreground">{traces.length} runs</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-4 text-xs text-muted-foreground">Loading...</div>
        )}

        {!loading && traces.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">No executions yet</div>
        )}

        {traces.map((trace) => {
          const status = STATUS_STYLES[trace!.status] ?? STATUS_STYLES.error;
          const StatusIcon = status.icon;
          const duration = trace!.durationMs != null ? `${(trace!.durationMs / 1000).toFixed(1)}s` : '—';
          const time = new Date(trace!.startedAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });

          return (
            <button
              key={trace!.id}
              className="w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors"
              onClick={() => setSelectedTrace(trace)}
            >
              <div className="flex items-center gap-2">
                <StatusIcon className={cn('w-3.5 h-3.5 shrink-0', status.color)} />
                <span className="text-xs font-medium flex-1 truncate">{status.label}</span>
                <span className="text-[10px] text-muted-foreground">{duration}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 ml-5.5">
                <span className="text-[10px] text-muted-foreground truncate">{trace!.triggerSummary}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{time}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Trace detail — step-by-step inspector
// ============================================================

function TraceDetail({ parsed, onBack }: { parsed: any; onBack: () => void }) {
  return (
    <div className="w-full sm:w-80 border-l flex flex-col min-h-0 h-full shrink-0 bg-background">
      <div className="h-12 border-b flex items-center gap-2 px-3 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium flex-1 truncate">
          {parsed?.automationName ?? 'Execution'}
        </span>
      </div>

      {parsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Summary */}
          <div className="p-3 border-b space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-medium', STATUS_STYLES[parsed.status]?.color)}>
                {STATUS_STYLES[parsed.status]?.label ?? parsed.status}
              </span>
              {parsed.error && <span className="text-[10px] text-red-400 truncate">{parsed.error}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(parsed.startedAt).toLocaleString()}
              {parsed.finishedAt && ` — ${((new Date(parsed.finishedAt).getTime() - new Date(parsed.startedAt).getTime()) / 1000).toFixed(2)}s`}
            </div>
          </div>

          {/* Steps */}
          <div className="p-2">
            <p className="text-[10px] text-muted-foreground px-1 mb-1">Steps ({parsed.steps?.length ?? 0})</p>
            {parsed.steps?.map((step: any, i: number) => (
              <StepRow key={i} step={step} />
            ))}
          </div>

          {/* Variables */}
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

export function StepRow({ step }: { step: any }) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_STYLES[step.result === 'executed' ? 'success' : step.result === 'error' ? 'error' : 'stopped'];
  const StatusIcon = status?.icon ?? Clock;

  return (
    <div className="border rounded mb-1">
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <StatusIcon className={cn('w-3 h-3 shrink-0', status?.color ?? 'text-gray-400')} />
        <span className="text-[10px] font-medium flex-1 truncate">{step.nodeSummary || step.nodeType}</span>
        <span className="text-[9px] text-muted-foreground">{step.nodeType}</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {step.input && (
            <div>
              <p className="text-[9px] text-muted-foreground">Input</p>
              <pre className="text-[9px] font-mono bg-muted p-1.5 rounded overflow-x-auto max-h-24">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
          )}
          {step.output && (
            <div>
              <p className="text-[9px] text-muted-foreground">Output</p>
              <pre className="text-[9px] font-mono bg-muted p-1.5 rounded overflow-x-auto max-h-24">
                {JSON.stringify(step.output, null, 2)}
              </pre>
            </div>
          )}
          {step.error && (
            <div className="text-[9px] text-red-400">{step.error}</div>
          )}
          {step.children?.length > 0 && (
            <div className="pl-2 border-l">
              {step.children.map((child: any, i: number) => (
                <StepRow key={i} step={child} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Inline variant for left sidebar embedding
// ============================================================

export function ExecutionHistoryInline({ automationId }: { automationId: string }) {
  const [selectedTrace, setSelectedTrace] = useState<any>(null);

  const { data: historyData, loading } = useQuery(GET_EXECUTION_HISTORY, {
    variables: { automationId, limit: 50 },
    fetchPolicy: 'network-only',
  });

  const traces = (historyData?.hcExecutionTraces ?? []).map(parseTraceEntity).filter(Boolean) as ReturnType<typeof parseTraceEntity>[];

  return (
    <>
      <div className="px-1.5 pb-1">
        {loading && (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">Loading...</div>
        )}

        {!loading && traces.length === 0 && (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">No executions yet</div>
        )}

        {traces.map((trace) => {
          const status = STATUS_STYLES[trace!.status] ?? STATUS_STYLES.error;
          const StatusIcon = status.icon;
          const duration = trace!.durationMs != null ? `${(trace!.durationMs / 1000).toFixed(1)}s` : '—';
          const time = new Date(trace!.startedAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });

          return (
            <button
              key={trace!.id}
              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
              onClick={() => setSelectedTrace(trace)}
            >
              <div className="flex items-center gap-1.5">
                <StatusIcon className={cn('w-3 h-3 shrink-0', status.color)} />
                <span className="text-[10px] font-medium flex-1 truncate">{status.label}</span>
                <span className="text-[9px] text-muted-foreground">{duration}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 ml-[18px]">
                <span className="text-[9px] text-muted-foreground truncate flex-1">{trace!.triggerSummary}</span>
                <span className="text-[9px] text-muted-foreground shrink-0">{time}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Trace detail dialog */}
      <Dialog open={!!selectedTrace} onOpenChange={(open) => { if (!open) setSelectedTrace(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-0 gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogTitle className="sr-only">Execution Trace</DialogTitle>
          {selectedTrace && <TraceDetailInline parsed={selectedTrace.parsed} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TraceDetailInline({ parsed }: { parsed: any }) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      {parsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-3 pr-10 border-b space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-medium', STATUS_STYLES[parsed.status]?.color)}>
                {STATUS_STYLES[parsed.status]?.label ?? parsed.status}
              </span>
              {parsed.error && <span className="text-[10px] text-red-400 truncate">{parsed.error}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(parsed.startedAt).toLocaleString()}
              {parsed.finishedAt && ` — ${((new Date(parsed.finishedAt).getTime() - new Date(parsed.startedAt).getTime()) / 1000).toFixed(2)}s`}
            </div>
          </div>

          <div className="p-2">
            <p className="text-[10px] text-muted-foreground px-1 mb-1">Steps ({parsed.steps?.length ?? 0})</p>
            {parsed.steps?.map((step: any, i: number) => (
              <StepRow key={i} step={step} />
            ))}
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
