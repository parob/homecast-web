// Automation Editor - Control Flow Edge
// Solid arrow with optional execution animation

import { memo } from 'react';
import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

export const ControlFlowEdge = memo(function ControlFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const isAnimated = (data as Record<string, unknown> | undefined)?.animated === true;
  const isError = (data as Record<string, unknown> | undefined)?.error === true;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: isError
          ? 'hsl(var(--destructive))'
          : selected
            ? 'hsl(var(--primary))'
            : 'hsl(var(--border))',
        strokeWidth: selected ? 2.5 : 2,
        strokeDasharray: isAnimated ? '5' : undefined,
        animation: isAnimated ? 'flow-dash 0.5s linear infinite' : undefined,
      }}
      markerEnd="url(#arrow)"
    />
  );
});
