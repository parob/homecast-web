// Automation Editor - Base Node Component
// Clean card style with colored icon circle

import { memo } from 'react';
import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import {
  Zap, Clock, Globe, AlertCircle, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow,
  AlertTriangle, Check, X, Loader2, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORY_STYLES, NODE_WIDTH, NODE_HEIGHT, type FlowNodeData } from '../constants';

const ICONS: Record<string, React.ElementType> = {
  Zap, Clock, Globe, AlertCircle, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow,
};

function getInputs(data: FlowNodeData): { id: string; label?: string }[] {
  if (data.nodeType === 'merge') {
    return [{ id: 'input-a', label: 'A' }, { id: 'input-b', label: 'B' }];
  }
  return [{ id: 'input' }];
}

function getOutputs(data: FlowNodeData): { id: string; label?: string }[] {
  if (data.nodeType === 'if') {
    return [{ id: 'true', label: 'T' }, { id: 'false', label: 'F' }];
  }
  if (data.nodeType === 'wait') {
    return [{ id: 'triggered', label: '✓' }, { id: 'timeout', label: '⏱' }];
  }
  return [{ id: 'output' }];
}

export const BaseNode = memo(function BaseNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const nodeData = data as FlowNodeData;
  const styles = CATEGORY_STYLES[nodeData.category] ?? CATEGORY_STYLES.action;
  const Icon = ICONS[nodeData.icon] ?? Zap;
  const isTrigger = nodeData.category === 'trigger';
  const inputs = getInputs(nodeData);
  const outputs = getOutputs(nodeData);
  const { deleteElements } = useReactFlow();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  const execRing =
    nodeData.executionState === 'completed' ? 'ring-2 ring-emerald-400' :
    nodeData.executionState === 'failed' ? 'ring-2 ring-red-400' :
    nodeData.executionState === 'running' ? 'ring-2 ring-blue-400 animate-pulse' :
    nodeData.executionState === 'skipped' ? 'opacity-40' : '';

  return (
    <div
      className="relative group"
      style={{ width: NODE_WIDTH }}
      data-testid={`node-${nodeData.nodeType}`}
    >
      {/* Delete button — visible on hover or when selected */}
      <button
        type="button"
        onClick={handleDelete}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'absolute -top-2 -right-2 w-5 h-5 rounded-full bg-background border shadow-sm items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive z-10 transition-opacity',
          selected ? 'flex' : 'hidden group-hover:flex',
        )}
        aria-label="Delete node"
        data-testid={`delete-node-${nodeData.nodeType}`}
      >
        <Trash2 className="w-2.5 h-2.5" />
      </button>

      {/* Input handle(s) */}
      {!isTrigger && inputs.length === 1 && (
        <Handle
          type="target"
          position={Position.Top}
          id={inputs[0].id}
          className="!w-2.5 !h-2.5 !rounded-full !border-2 !border-background !bg-muted-foreground/40 !-top-1.5"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        />
      )}
      {!isTrigger && inputs.length > 1 && inputs.map((inp, i) => {
        const pct = i === 0 ? 35 : 65;
        return (
          <Handle
            key={inp.id}
            type="target"
            position={Position.Top}
            id={inp.id}
            className="!w-2.5 !h-2.5 !rounded-full !border-2 !border-background !bg-purple-400 !-top-1.5"
            style={{ left: `${pct}%` }}
          />
        );
      })}

      {/* Node body — clean card with colored icon */}
      <div
        className={cn(
          'flex items-center gap-2.5 px-3 rounded-xl border bg-background shadow-sm transition-shadow',
          selected && 'ring-2 ring-primary/40 shadow-md',
          execRing,
          !nodeData.enabled && 'opacity-40 grayscale',
          !nodeData.isConfigured && 'border-dashed border-muted-foreground/30',
        )}
        style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
      >
        {/* Colored icon circle */}
        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', styles.iconBg)}>
          <Icon className={cn('w-3.5 h-3.5', styles.iconColor)} />
        </div>

        <div className="min-w-0 flex-1 py-2">
          <div className="text-xs font-medium truncate leading-tight">{nodeData.label}</div>
          {nodeData.subtitle ? (
            <div className="text-[10px] text-muted-foreground line-clamp-2 leading-tight mt-0.5">{nodeData.subtitle}</div>
          ) : !nodeData.isConfigured ? (
            <div className="text-[10px] text-muted-foreground/50 leading-tight mt-0.5">Click to configure</div>
          ) : null}
        </div>

        {/* Unconfigured indicator */}
        {!nodeData.isConfigured && (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        )}
      </div>

      {/* Execution status badge */}
      {nodeData.executionState === 'completed' && (
        <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
          <Check className="w-2.5 h-2.5 text-white" />
        </div>
      )}
      {nodeData.executionState === 'failed' && (
        <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center" title={nodeData.executionError}>
          <X className="w-2.5 h-2.5 text-white" />
        </div>
      )}
      {nodeData.executionState === 'running' && (
        <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
          <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
        </div>
      )}

      {/* Output handles */}
      {outputs.length === 1 ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id={outputs[0].id}
          className="!w-2.5 !h-2.5 !rounded-full !border-2 !border-background !bg-muted-foreground/40 !-bottom-1.5"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        />
      ) : (
        outputs.map((out, i) => {
          const pct = i === 0 ? 35 : 65;
          return (
            <Handle
              key={out.id}
              type="source"
              position={Position.Bottom}
              id={out.id}
              className={cn(
                '!w-2.5 !h-2.5 !rounded-full !border-2 !border-background !-bottom-1.5',
                i === 0 ? '!bg-emerald-500' : '!bg-red-400',
              )}
              style={{ left: `${pct}%` }}
            />
          );
        })
      )}

      {/* Output labels for multi-output nodes */}
      {outputs.length > 1 && (
        <div className="flex justify-between px-6 mt-0.5" style={{ width: NODE_WIDTH }}>
          {outputs.map((out, i) => (
            <span
              key={out.id}
              className={cn(
                'text-[8px] font-medium',
                i === 0 ? 'text-emerald-600' : 'text-red-400',
              )}
            >
              {out.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
