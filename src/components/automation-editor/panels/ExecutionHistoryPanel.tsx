// Automation Editor - Execution History Panel
// Shows past execution traces with step-by-step inspection

import { useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_EXECUTION_HISTORY, GET_EXECUTION_TRACE } from '@/lib/graphql/queries';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, X, Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExecutionHistoryPanelProps {
  automationId: string;
  onClose: () => void;
  /** When true, skip outer wrapper chrome (width/border/bg + header) — caller provides it */
  embedded?: boolean;
}

const STATUS_STYLES: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  success: { color: 'text-emerald-600', icon: Check, label: 'Success' },
  error: { color: 'text-red-500', icon: X, label: 'Error' },
  stopped: { color: 'text-amber-500', icon: Clock, label: 'Stopped' },
  cancelled: { color: 'text-gray-400', icon: X, label: 'Cancelled' },
  timeout: { color: 'text-amber-500', icon: Clock, label: 'Timeout' },
};

export function ExecutionHistoryPanel({ automationId, onClose, embedded }: ExecutionHistoryPanelProps) {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const { data: historyData, loading } = useQuery(GET_EXECUTION_HISTORY, {
    variables: { automationId, limit: 50 },
    fetchPolicy: 'network-only',
  });

  const traces = historyData?.executionHistory ?? [];

  if (selectedTraceId) {
    return <TraceDetail traceId={selectedTraceId} onBack={() => setSelectedTraceId(null)} embedded={embedded} />;
  }

  return (
    <div className={cn(
      'flex flex-col min-h-0 h-full shrink-0 bg-background',
      embedded ? 'w-full' : 'w-full sm:w-80 border-l',
    )}>
      {!embedded && (
        <div className="h-12 border-b flex items-center gap-2 px-3 shrink-0">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium flex-1">Execution History</span>
          <span className="text-[10px] text-muted-foreground">{traces.length} runs</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-4 text-xs text-muted-foreground">Loading...</div>
        )}

        {!loading && traces.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">No executions yet</div>
        )}

        {traces.map((trace: any) => {
          const status = STATUS_STYLES[trace.status] ?? STATUS_STYLES.error;
          const StatusIcon = status.icon;
          const duration = trace.durationMs != null ? `${(trace.durationMs / 1000).toFixed(1)}s` : '—';
          const time = new Date(trace.startedAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });

          return (
            <button
              key={trace.id}
              className="w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors"
              onClick={() => setSelectedTraceId(trace.id)}
            >
              <div className="flex items-center gap-2">
                <StatusIcon className={cn('w-3.5 h-3.5 shrink-0', status.color)} />
                <span className="text-xs font-medium flex-1 truncate">{status.label}</span>
                <span className="text-[10px] text-muted-foreground">{duration}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 ml-5.5">
                <span className="text-[10px] text-muted-foreground truncate">{trace.triggerSummary}</span>
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

function TraceDetail({ traceId, onBack, embedded }: { traceId: string; onBack: () => void; embedded?: boolean }) {
  const { data, loading } = useQuery(GET_EXECUTION_TRACE, {
    variables: { traceId },
    fetchPolicy: 'network-only',
  });

  const trace = data?.executionTrace;
  const parsed = trace?.traceJson ? JSON.parse(trace.traceJson) : null;

  return (
    <div className={cn(
      'flex flex-col min-h-0 h-full shrink-0 bg-background',
      embedded ? 'w-full' : 'w-full sm:w-80 border-l',
    )}>
      <div className="h-12 border-b flex items-center gap-2 px-3 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium flex-1 truncate">
          {trace?.automationName ?? 'Execution'}
        </span>
      </div>

      {loading && <div className="p-4 text-xs text-muted-foreground">Loading...</div>}

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

function StepRow({ step }: { step: any }) {
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
