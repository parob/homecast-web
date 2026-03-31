// Automation Editor - Base Node Component
// Node-RED style: rectangular with colored left border, icon + label inline

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  Zap, Clock, Globe, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, Pause, AlertTriangle, Check, X, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORY_STYLES, NODE_WIDTH, NODE_HEIGHT, type FlowNodeData } from '../constants';

const ICONS: Record<string, React.ElementType> = {
  Zap, Clock, Globe, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, Pause,
};

function getOutputs(data: FlowNodeData): { id: string; label?: string }[] {
  if (data.nodeType === 'if') {
    return [{ id: 'true', label: 'T' }, { id: 'false', label: 'F' }];
  }
  if (data.nodeType === 'wait') {
    return [{ id: 'triggered', label: '✓' }, { id: 'timeout', label: '⏱' }];
  }
  return [{ id: 'output' }];
}

export const BaseNode = memo(function BaseNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const nodeData = data as FlowNodeData;
  const styles = CATEGORY_STYLES[nodeData.category] ?? CATEGORY_STYLES.action;
  const Icon = ICONS[nodeData.icon] ?? Zap;
  const isTrigger = nodeData.category === 'trigger';
  const outputs = getOutputs(nodeData);

  const execRing =
    nodeData.executionState === 'completed' ? 'ring-2 ring-emerald-400' :
    nodeData.executionState === 'failed' ? 'ring-2 ring-red-400' :
    nodeData.executionState === 'running' ? 'ring-2 ring-blue-400 animate-pulse' :
    nodeData.executionState === 'skipped' ? 'opacity-40' : '';

  return (
    <div
      className="relative"
      style={{ width: NODE_WIDTH }}
      data-testid={`node-${nodeData.nodeType}`}
    >
      {/* Input handle (not for triggers) */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2.5 !h-2.5 !rounded-full !border-2 !border-background !bg-muted-foreground/40 !-top-1.5"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        />
      )}

      {/* Node body — rectangular with colored left border */}
      <div
        className={cn(
          'flex items-center gap-2.5 px-2.5 rounded-lg border border-l-4 bg-background transition-shadow',
          styles.borderColor,
          selected && 'ring-2 ring-primary/40 shadow-md',
          execRing,
          !nodeData.enabled && 'opacity-40 grayscale',
        )}
        style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      >
        <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate leading-tight">{nodeData.label}</div>
          {nodeData.subtitle && (
            <div className="text-[10px] text-muted-foreground truncate leading-tight">{nodeData.subtitle}</div>
          )}
        </div>

        {/* Unconfigured warning dot */}
        {!nodeData.isConfigured && (
          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
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
        <div className="flex justify-between px-4 mt-0.5" style={{ width: NODE_WIDTH }}>
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
