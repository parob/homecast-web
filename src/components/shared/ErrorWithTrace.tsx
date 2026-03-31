import { useState, type ReactNode } from 'react';
import { WifiOff, ChevronDown, ChevronRight, CheckCircle2, XCircle, ArrowRightLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import type { RequestTrace, TraceStep } from '@/lib/types/trace';
import { STEP_LABELS } from '@/lib/types/trace';
import { cn } from '@/lib/utils';

interface ErrorWithTraceProps {
  title: string;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
  trace?: RequestTrace | null;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  isDarkBackground?: boolean;
  actions?: ReactNode;
}

export function ErrorWithTrace({
  title,
  message,
  errorCode,
  errorMessage,
  trace,
  icon: Icon = WifiOff,
  className,
  isDarkBackground,
  actions,
}: ErrorWithTraceProps) {
  const [open, setOpen] = useState(false);
  const hasTrace = trace && trace.steps.length > 0;

  return (
    <Card className={className}>
      <CardContent className={cn("py-12 text-center", isDarkBackground && "text-white")}>
        <Icon className={cn("h-12 w-12 mx-auto", isDarkBackground ? "text-white/60" : "text-muted-foreground")} />
        <h3 className="mt-4 text-lg font-medium">{title}</h3>

        {errorCode || errorMessage ? (
          <p className={cn("mt-2 text-sm font-mono selectable", isDarkBackground ? "text-white/70" : "text-muted-foreground")}>
            {errorCode && <span className="font-semibold">{errorCode}</span>}
            {errorCode && errorMessage && ': '}
            {errorMessage}
          </p>
        ) : message ? (
          <p className={cn("mt-2", isDarkBackground ? "text-white/70" : "text-muted-foreground")}>{message}</p>
        ) : null}

        {actions && <div className="mt-4">{actions}</div>}

        {hasTrace && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <button className={cn(
                "mt-4 inline-flex items-center gap-1 text-xs transition-colors",
                isDarkBackground ? "text-white/60 hover:text-white" : "text-muted-foreground hover:text-foreground"
              )}>
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Request trace
                {trace.totalMs != null && (
                  <span className={isDarkBackground ? "text-white/40" : "text-muted-foreground/60"}>({trace.totalMs.toLocaleString()}ms)</span>
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 text-left mx-auto max-w-sm">
                <div className="space-y-1.5">
                  {trace.steps.map((step, i) => (
                    <TraceStepRow key={i} step={step} isDarkBackground={isDarkBackground} />
                  ))}
                </div>

                {trace.routing && (
                  <div className={cn(
                    "mt-3 pt-3 border-t text-xs space-y-1",
                    isDarkBackground ? "border-white/20 text-white/60" : "text-muted-foreground"
                  )}>
                    <div className="flex items-center gap-1.5">
                      <ArrowRightLeft className="h-3 w-3 shrink-0" />
                      <span>
                        {trace.routing.mode === 'pubsub'
                          ? `Pub/Sub: ${trace.routing.sourceSlot} \u2192 ${trace.routing.targetSlot}`
                          : 'Direct (same instance)'}
                      </span>
                    </div>
                    {trace.routing.retried && (
                      <div className="text-yellow-600 dark:text-yellow-400">
                        Request was retried (stale routing)
                      </div>
                    )}
                  </div>
                )}

                {trace.id && (
                  <div className={cn(
                    "mt-2 text-[10px] font-mono truncate selectable",
                    isDarkBackground ? "text-white/30" : "text-muted-foreground/50"
                  )}>
                    trace: {trace.id}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function TraceStepRow({ step, isDarkBackground }: { step: TraceStep; isDarkBackground?: boolean }) {
  const label = STEP_LABELS[step.name] || step.name;
  const isOk = step.status === 'ok';

  return (
    <div className={cn('flex items-center gap-2 text-xs', !isOk && 'font-medium')}>
      {isOk ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
      ) : (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
      )}
      <span className="shrink-0">{label}</span>
      {step.detail && (
        <span
          className={cn(isDarkBackground ? "text-white/50" : "text-muted-foreground/70")}
        >
          {step.detail}
        </span>
      )}
      {step.ms != null && (
        <span className={cn("tabular-nums shrink-0", isDarkBackground ? "text-white/40" : "text-muted-foreground/50")}>
          {step.ms.toLocaleString()}ms
        </span>
      )}
    </div>
  );
}
