// Automation Editor - Live execution hook
// Folds the engine's ExecutionEvent stream into a trace-shaped object the
// run-view overlay can render directly. Only receives events when the editor
// runs in the same context as the engine (see live-execution.ts).

import { useEffect, useState } from 'react';
import { subscribeExecutionEvents } from '@/automation/live-execution';
import type { TraceStep } from '@/automation/types/execution';
import type { TriggerData } from '@/automation/types/automation';

export interface LiveTrace {
  id: string;
  automationId: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  steps: TraceStep[];
  variables: Record<string, unknown>;
  triggerData?: TriggerData;
  error?: string;
  /** Started by the editor's Run Test button (manual trigger). */
  isTest: boolean;
}

export function useLiveExecution(automationId: string | undefined | null): LiveTrace | null {
  const [trace, setTrace] = useState<LiveTrace | null>(null);

  useEffect(() => {
    if (!automationId) return;
    setTrace(null);

    return subscribeExecutionEvents(automationId, (e) => {
      setTrace((prev) => {
        switch (e.type) {
          case 'started':
            return {
              id: e.traceId,
              automationId: e.automationId,
              status: 'running',
              startedAt: e.timestamp,
              steps: [],
              variables: {},
              triggerData: e.triggerData,
              isTest: e.triggerData?.eventType === 'manual_trigger',
            };
          case 'step': {
            if (!prev || prev.id !== e.traceId) return prev;
            const steps = [...prev.steps];
            const at = steps.findIndex((s) => s.index === e.step.index);
            if (at >= 0) steps[at] = e.step;
            else steps.push(e.step);
            return { ...prev, steps };
          }
          case 'variables_changed':
            if (!prev || prev.id !== e.traceId) return prev;
            return { ...prev, variables: e.variables };
          case 'finished':
            if (!prev || prev.id !== e.traceId) return prev;
            return { ...prev, status: e.status, error: e.error, finishedAt: e.timestamp };
          default:
            return prev;
        }
      });
    });
  }, [automationId]);

  return trace;
}
