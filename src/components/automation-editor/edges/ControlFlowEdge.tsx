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
  markerEnd,
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
            // --border is near-white in light mode and near-black in dark, so
            // connections were all but invisible against the canvas either way.
            : 'hsl(var(--muted-foreground) / 0.45)',
        strokeWidth: selected ? 2.5 : 2,
        strokeDasharray: isAnimated ? '5' : undefined,
        // Keyframes live in index.css; previously referenced but never defined,
        // so animated edges rendered as static dashes.
        animation: isAnimated ? 'flow-dash 0.5s linear infinite' : undefined,
      }}
      // Was url(#arrow), a marker that exists nowhere in the app — so the graph
      // rendered with no arrowheads at all and flow direction was unreadable.
      markerEnd={markerEnd}
    />
  );
});
