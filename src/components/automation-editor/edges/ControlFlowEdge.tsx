// Automation Editor - Control Flow Edge
// Solid arrow with optional execution animation, and a hover-to-delete control

import { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { Trash2 } from 'lucide-react';

// Arrowhead ids. React Flow's injected MarkerType.ArrowClosed takes a single
// static colour from defaultEdgeOptions, so a selected or errored edge kept a
// grey head while its line turned blue or red — the mismatch is what made the
// arrow look wrong. Owning the markers lets the head follow the stroke.
const ARROW_DEFAULT = 'hc-edge-arrow';
const ARROW_SELECTED = 'hc-edge-arrow-selected';
const ARROW_ERROR = 'hc-edge-arrow-error';

const STROKE_DEFAULT = 'hsl(var(--muted-foreground) / 0.45)';
const STROKE_SELECTED = 'hsl(var(--primary))';
const STROKE_ERROR = 'hsl(var(--destructive))';

/**
 * Arrowhead definitions, rendered once inside the canvas.
 *
 * Sized down from React Flow's 18x18 default: on a 2px line that read as a
 * blunt wedge rather than an arrow. `orient="auto-start-reverse"` keeps it
 * aligned on the smoothstep curve's final segment.
 */
export function EdgeMarkerDefs() {
  return (
    <svg className="absolute h-0 w-0" aria-hidden="true">
      <defs>
        {[
          [ARROW_DEFAULT, STROKE_DEFAULT],
          [ARROW_SELECTED, STROKE_SELECTED],
          [ARROW_ERROR, STROKE_ERROR],
        ].map(([id, color]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX="8.5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M 1 1.5 L 9 5 L 1 8.5 z" fill={color} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

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
  const { deleteElements } = useReactFlow();
  // React Flow gives edges `selected` but no hover state, and the delete
  // control lives in an HTML overlay outside the SVG — so CSS :hover/group-hover
  // can't reach it from the path. Track it ourselves across both.
  const [hovered, setHovered] = useState(false);
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

  const stroke = isError ? STROKE_ERROR : selected ? STROKE_SELECTED : STROKE_DEFAULT;
  const arrow = isError ? ARROW_ERROR : selected ? ARROW_SELECTED : ARROW_DEFAULT;

  return (
    // Wraps the path so hovering anywhere along the edge — including its wide
    // invisible hit area — reveals the delete control, matching how a node
    // reveals its own on hover.
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          // --border is near-white in light mode and near-black in dark, so
          // connections were all but invisible against the canvas either way.
          stroke,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: isAnimated ? '5' : undefined,
          // Keyframes live in index.css; previously referenced but never defined,
          // so animated edges rendered as static dashes.
          animation: isAnimated ? 'flow-dash 0.5s linear infinite' : undefined,
        }}
        // Our own marker (see EdgeMarkerDefs) rather than React Flow's injected
        // one, so the arrowhead tracks the stroke colour per state.
        markerEnd={`url(#${arrow})`}
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
          className="nodrag nopan absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
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
              'h-5 w-5 items-center justify-center rounded-full border bg-background shadow-sm',
              'text-muted-foreground hover:text-destructive hover:border-destructive',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              // Hidden until hover or selection — same affordance as a node's
              // delete button, rather than a permanently visible faded control.
              selected || hovered ? 'flex' : 'hidden',
            ].join(' ')}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </g>
  );
});
