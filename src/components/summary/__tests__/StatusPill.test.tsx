// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StatusPill } from '../StatusPill';
import type { HomeKitAccessory } from '@/native/homekit-bridge';

function sensor(id: string, serviceType: string, characteristicType: string, value: number | boolean): HomeKitAccessory {
  return {
    id,
    name: `Sensor ${id}`,
    roomName: 'Hallway',
    category: 'sensor',
    isReachable: true,
    services: [
      {
        id: `svc-${id}`,
        name: serviceType,
        serviceType,
        characteristics: [
          { id: `char-${id}`, characteristicType, value, isReadable: true, isWritable: false },
        ],
      },
    ],
  };
}

const motion = sensor('a', 'motion_sensor', 'motion_detected', false);
const temperature = sensor('b', 'temperature_sensor', 'current_temperature', 20.5);

describe('StatusPill', () => {
  afterEach(cleanup);

  it('renders nothing when no accessory reports a summarised reading', () => {
    const { container } = render(<StatusPill accessories={[]} open={false} onToggle={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders once any accessory reports, with no count after the label', () => {
    render(<StatusPill accessories={[motion, temperature]} open={false} onToggle={() => {}} />);
    expect(screen.getByRole('button').textContent).toBe('Status');
  });

  it('toggles on click', () => {
    const onToggle = vi.fn();
    render(<StatusPill accessories={[motion]} open={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /status/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
