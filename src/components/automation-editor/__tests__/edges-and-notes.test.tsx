// @vitest-environment jsdom
/**
 * ControlFlowEdge and StickyNoteNode were both at 0%.
 *
 * The edge matters most: it carries the delete button added after users
 * reported that connections could only be removed with the keyboard, and it
 * previously shipped with a markerEnd pointing at a marker that didn't exist,
 * so the graph drew no arrowheads at all. Neither was caught by anything.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';

const deleteElements = vi.fn(async () => ({ deletedNodes: [], deletedEdges: [] }));
vi.mock('@xyflow/react', async (orig) => {
  const actual = await orig<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow, deleteElements }),
    // EdgeLabelRenderer portals into the canvas, which only exists inside a real
    // <ReactFlow>. Render inline so the label's own markup can be asserted.
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { ControlFlowEdge, EdgeMarkerDefs } from '../edges/ControlFlowEdge';
import { StickyNoteNode } from '../nodes/StickyNoteNode';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

const edgeProps = {
  id: 'e1', source: 'a', target: 'b',
  sourceX: 0, sourceY: 0, targetX: 100, targetY: 100,
  sourcePosition: 'bottom', targetPosition: 'top',
} as never;

function renderEdge(extra: Record<string, unknown> = {}) {
  return render(
    <ReactFlowProvider>
      <svg><ControlFlowEdge {...edgeProps} {...extra} /></svg>
    </ReactFlowProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ControlFlowEdge', () => {
  it('renders a path', () => {
    const { container } = renderEdge();
    expect(container.querySelector('path')).toBeTruthy();
  });

  it('offers a delete control, so removing a connection is not keyboard-only', () => {
    renderEdge();
    expect(screen.getByLabelText(/delete connection/i)).toBeTruthy();
  });

  it('deletes through the change pipeline so the editor marks itself dirty', () => {
    renderEdge();

    fireEvent.click(screen.getByLabelText(/delete connection/i));

    // deleteElements, not setEdges — setEdges mutates the graph directly and
    // leaves Save disabled, silently losing the change.
    expect(deleteElements).toHaveBeenCalledWith({ edges: [{ id: 'e1' }] });
  });

  it('hides the delete control until the edge is hovered', () => {
    // Previously a permanently visible faded button sat on every edge, which
    // was noisy on a dense graph. Nodes reveal their delete on hover; edges
    // now match.
    // Read `class` via getAttribute, not `.className`: getByLabelText resolves
    // to the inner <svg>, and this harness renders the label inside an <svg>
    // too (EdgeLabelRenderer is mocked inline), so `.className` is an
    // SVGAnimatedString — a className assertion through it silently passes
    // whatever the markup actually does.
    const { container } = renderEdge();
    const btn = () => container.querySelector('button[aria-label="Delete connection"]')!;
    expect(btn().getAttribute('class')).toMatch(/\bhidden\b/);

    fireEvent.mouseEnter(container.querySelector('g')!);
    expect(btn().getAttribute('class')).toMatch(/\bflex\b/);
  });

  it('shows the delete control while the edge is selected', () => {
    const { container } = renderEdge({ selected: true });
    const btn = container.querySelector('button[aria-label="Delete connection"]')!;
    expect(btn.getAttribute('class')).toMatch(/\bflex\b/);
  });

  it('uses the same bin icon as a node, not an X', () => {
    const { container } = renderEdge({ selected: true });
    const icon = container.querySelector('button[aria-label="Delete connection"] svg');
    expect(String(icon?.getAttribute('class'))).toMatch(/trash/i);
  });

  it('gives the edge a hit band far wider than its 2px line', () => {
    // The interaction path is the whole target for selecting an edge and for
    // revealing its delete control; 24 was still easy to miss.
    const { container } = renderEdge();
    const widths = Array.from(container.querySelectorAll('path'))
      .map((p) => Number(p.getAttribute('stroke-width') ?? p.style.strokeWidth ?? 0));
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(40);
  });

  it('fills every arrowhead opaquely so the line cannot show through it', () => {
    // Render the defs themselves — the edge only references them by id, so
    // asserting through renderEdge() would query nothing and pass vacuously.
    const { container } = render(<EdgeMarkerDefs />);
    const heads = Array.from(container.querySelectorAll('marker path'));
    expect(heads.length).toBe(3);
    for (const head of heads) {
      const fill = String(head.getAttribute('fill'));
      // An "/ 0.45" alpha in the hsl() is what let the line show through and
      // made the head read as sitting behind it.
      expect(fill).not.toMatch(/\/\s*0?\.\d/);
    }
  });

  it('points at an arrowhead that matches the edge state', () => {
    const { container: plain } = renderEdge();
    const normalMarker = plain.querySelector('path')!.getAttribute('marker-end');
    expect(normalMarker).toMatch(/url\(#hc-edge-arrow\)/);
    cleanup();

    const { container: sel } = renderEdge({ selected: true });
    // A grey head on a highlighted line is what read as "weird".
    expect(sel.querySelector('path')!.getAttribute('marker-end')).not.toBe(normalMarker);
  });

  it('styles an error edge differently from a normal one', () => {
    const { container: plain } = renderEdge();
    const normal = plain.querySelector('path')!.getAttribute('style');
    cleanup();

    const { container: bad } = renderEdge({ data: { error: true } });
    expect(bad.querySelector('path')!.getAttribute('style')).not.toBe(normal);
  });

  it('highlights when selected', () => {
    const { container } = renderEdge({ selected: true });
    expect(container.querySelector('path')!.getAttribute('style')).toMatch(/primary/);
  });
});

describe('StickyNoteNode', () => {
  const noteProps = {
    id: 'n1', selected: false, type: 'stickyNote', dragging: false, zIndex: 0,
    isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
  } as never;

  it('renders its text', () => {
    render(
      <ReactFlowProvider>
        <StickyNoteNode {...noteProps} data={{ config: { text: 'Remember the milk' } } as never} />
      </ReactFlowProvider>,
    );
    expect(screen.getByDisplayValue('Remember the milk')).toBeTruthy();
  });

  it('renders with no text set', () => {
    expect(() => render(
      <ReactFlowProvider>
        <StickyNoteNode {...noteProps} data={{ config: {} } as never} />
      </ReactFlowProvider>,
    )).not.toThrow();
  });
});
