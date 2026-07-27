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

import { ControlFlowEdge } from '../edges/ControlFlowEdge';
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

  it('keeps the control visible rather than fully hidden', () => {
    renderEdge();
    // opacity-0 would make it impossible to hover into existence.
    expect(String(screen.getByLabelText(/delete connection/i).className)).not.toMatch(/\bopacity-0\b/);
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
