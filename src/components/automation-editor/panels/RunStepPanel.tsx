// Automation Editor - Run step inspector
// Shown in the config-panel slot while viewing a run on the canvas: tapping a
// node shows what that node actually did in the selected execution.

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepRow, buildStepTree, type TraceEntitySource } from './ExecutionHistoryPanel';

export function RunStepPanel({
  nodeId,
  nodeLabel,
  trace,
  entitySource,
  onClose,
}: {
  nodeId: string;
  nodeLabel: string;
  trace: any;
  entitySource?: TraceEntitySource;
  onClose: () => void;
}) {
  // The node's steps with their nested children (branch/iteration tags).
  const stepNodes = useMemo(() => {
    const tree = buildStepTree(trace?.steps ?? []);
    const matches: ReturnType<typeof buildStepTree> = [];
    const visit = (nodes: typeof tree) => {
      for (const n of nodes) {
        if (n.step.nodeId === nodeId) matches.push(n);
        else visit(n.children);
      }
    };
    visit(tree);
    return matches;
  }, [trace, nodeId]);

  return (
    <div className="h-full flex flex-col bg-background border rounded-none sm:rounded-xl shadow-lg overflow-hidden">
      <div className="h-12 border-b flex items-center gap-2 px-3 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{nodeLabel}</div>
          <div className="text-[10px] text-muted-foreground">In this run</div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {stepNodes.length === 0 && (
          <p className="text-[10px] text-muted-foreground px-1 py-2">
            This node didn't run in this execution.
          </p>
        )}
        {stepNodes.map((n, i) => (
          <StepRow key={i} step={n.step} entitySource={entitySource} childNodes={n.children} />
        ))}
      </div>
    </div>
  );
}
