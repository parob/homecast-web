// @vitest-environment jsdom
/**
 * The hold that enters Edit Layout, at the seam every grid shares.
 *
 * `beginLift` is what turns the mode on, and it is called from `onDragStart` —
 * so if a drag can activate without reaching it, the gesture silently degrades
 * into "you may now drag this one tile", which is exactly what it must not be.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { DraggableGrid } from '@/components/shared/DraggableGrid';
import { SortableItem } from '@/components/shared/SortableItem';
import { DragHandleArea } from '@/components/shared/DragHandleArea';
import { LayoutEditProvider } from '@/contexts/LayoutEditContext';
import { LIFT_DELAY_IDLE } from '@/lib/long-press';

function renderGrid(layout: Parameters<typeof LayoutEditProvider>[0]['value']) {
  return render(
    <LayoutEditProvider value={layout}>
      <DraggableGrid itemIds={['a', 'b']} onReorder={() => {}} touchMode={layout.touchMode} enabled>
        <SortableItem id="a"><DragHandleArea><div data-testid="a">A</div></DragHandleArea></SortableItem>
        <SortableItem id="b"><DragHandleArea><div data-testid="b">B</div></DragHandleArea></SortableItem>
      </DraggableGrid>
    </LayoutEditProvider>,
  );
}

const hold = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('a hold on a tile', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('enters Edit Layout, rather than only picking that one tile up', () => {
    const beginLift = vi.fn();
    renderGrid({ touchMode: true, editMode: false, beginLift, endLift: vi.fn() });

    fireEvent.touchStart(screen.getByTestId('a'), { touches: [{ clientX: 10, clientY: 10 }] });
    hold(LIFT_DELAY_IDLE + 20);

    expect(beginLift).toHaveBeenCalled();
  });

  it('does not enter before the hold is up', () => {
    const beginLift = vi.fn();
    renderGrid({ touchMode: true, editMode: false, beginLift, endLift: vi.fn() });

    fireEvent.touchStart(screen.getByTestId('a'), { touches: [{ clientX: 10, clientY: 10 }] });
    hold(LIFT_DELAY_IDLE - 50);

    expect(beginLift).not.toHaveBeenCalled();
  });

  it('ends the lift when the drag is cancelled, not only when it is dropped', () => {
    // Without this the deferred tidy-up never runs: the sidebar stays narrow and
    // hidden tiles never appear. DraggableGrid had no onDragCancel at all.
    const endLift = vi.fn();
    renderGrid({ touchMode: true, editMode: false, beginLift: vi.fn(), endLift });

    fireEvent.touchStart(screen.getByTestId('a'), { touches: [{ clientX: 10, clientY: 10 }] });
    hold(LIFT_DELAY_IDLE + 20);
    act(() => { fireEvent.touchCancel(screen.getByTestId('a')); });

    expect(endLift).toHaveBeenCalled();
  });
});
