// Automation Editor - Control Flow Edge
// Solid arrow with optional execution animation, and a hover-to-delete control

import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';

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
  const { deleteElements } = useReactFlow();
  const [edgePath, labelX, labelY] = getSmoothStepPath({
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
    <>
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
        // Widen the invisible hit area: a 2px line is a very small mouse target,
        // and the delete control below only appears once the edge is hoverable.
        interactionWidth={24}
      />

      {/*
        Removing a connection was keyboard-only — select the edge and press
        Delete. There was no pointer affordance at all, so the capability was
        undiscoverable. This button rides the midpoint of the edge and appears
        on hover or selection.
      */}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan group/edge absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <button
            type="button"
            aria-label="Delete connection"
            title="Delete connection"
            onClick={(e) => {
              e.stopPropagation();
              // deleteElements (not setEdges) so this goes through the same
              // change pipeline as the Delete key — otherwise the editor never
              // marks itself dirty and Save stays disabled.
              void deleteElements({ edges: [{ id }] });
            }}
            className={[
              'flex h-5 w-5 items-center justify-center rounded-full border bg-background shadow-sm',
              'text-muted-foreground transition-opacity hover:text-destructive hover:border-destructive',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'opacity-100' : 'opacity-40 hover:opacity-100 focus-visible:opacity-100',
            ].join(' ')}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
