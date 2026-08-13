// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { ActionsPill } from '../ActionsSection';

function acc(id: string, serviceType: string, characteristicType: string, value: unknown, isWritable = true): HomeKitAccessory {
  return {
    id,
    name: id,
    roomName: 'Room',
    category: 'other',
    isReachable: true,
    services: [{
      id: `svc-${id}`,
      name: serviceType,
      serviceType,
      characteristics: [{ id: `char-${id}`, characteristicType, value, isReadable: true, isWritable }],
    }],
  } as HomeKitAccessory;
}

const light = acc('l', 'lightbulb', 'power_state', true);
const motionSensor = acc('m', 'motion_sensor', 'motion_detected', true, false);

describe('ActionsPill', () => {
  afterEach(cleanup);

  /**
   * The inverse of the assertion in automations/__tests__/visibility.test.tsx,
   * where the Scenes and Automations pills deliberately render at zero: hiding
   * them stranded the only route to creating a first scene. Actions cannot be
   * created, so there is nothing to strand and a home with nothing actionable
   * simply has no pill.
   */
  it('renders nothing when the home has nothing actionable', () => {
    const { container } = render(
      <ActionsPill accessories={[motionSensor]} homeLayout={null} open={false} onToggle={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for an empty home', () => {
    const { container } = render(
      <ActionsPill accessories={[]} homeLayout={null} open={false} onToggle={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows a count by default and drops it when counts are hidden', () => {
    const { rerender } = render(
      <ActionsPill accessories={[light]} homeLayout={null} open={false} onToggle={() => {}} />
    );
    // A lone light yields both "Lights" and "Everything off"
    expect(screen.getByRole('button').textContent).toBe('Actions 2');

    rerender(
      <ActionsPill accessories={[light]} homeLayout={null} open={false} onToggle={() => {}} hideAccessoryCounts />
    );
    expect(screen.getByRole('button').textContent).toBe('Actions');
  });

  it('excludes actions hidden for this home, and disappears once all are hidden', () => {
    const hideEverythingOff = { visibility: { hiddenActions: ['everything-off' as const] } };
    render(
      <ActionsPill accessories={[light]} homeLayout={hideEverythingOff} open={false} onToggle={() => {}} />
    );
    expect(screen.getByRole('button').textContent).toBe('Actions 1');
    cleanup();

    const hideBoth = { visibility: { hiddenActions: ['lights' as const, 'everything-off' as const] } };
    const { container } = render(
      <ActionsPill accessories={[light]} homeLayout={hideBoth} open={false} onToggle={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('reports presses and rotates the chevron while open', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ActionsPill accessories={[light]} homeLayout={null} open={false} onToggle={onToggle} />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').querySelector('.rotate-90')).toBeNull();

    rerender(<ActionsPill accessories={[light]} homeLayout={null} open onToggle={onToggle} />);
    expect(screen.getByRole('button').querySelector('.rotate-90')).not.toBeNull();
  });
});
