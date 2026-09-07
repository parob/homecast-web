// @vitest-environment jsdom
/**
 * The sheet a partial run opens into, rendered.
 *
 * The store is unit-tested next door; what is checked here is that each
 * accessory really does get its own reason and its own retry — which is the
 * whole reason this surface exists, since the toast can only carry one line
 * for all of them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ActionFailureSheet } from '../ActionFailureSheet';
import { closeActionFailures, openActionFailures, type ActionFailure } from '../action-failures';
import type { HomeActionWrite } from '../catalog';

const write = (accessoryId: string): HomeActionWrite => ({
  accessoryId,
  characteristicType: 'power_state',
  reportedCharacteristicType: 'power_state',
  value: true,
  previousValue: false,
});

const failure = (accessoryId: string, name: string, reason: string): ActionFailure =>
  ({ accessoryId, name, reason, write: write(accessoryId) });

function open(failures: ActionFailure[]) {
  const retry = vi.fn();
  openActionFailures({
    id: 'lights:1', actionLabel: 'All lights', at: Date.parse('2026-09-07T18:57:00Z'),
    failures, retry,
  });
  render(<ActionFailureSheet />);
  return { retry };
}

afterEach(() => { cleanup(); closeActionFailures(); });

describe('ActionFailureSheet', () => {
  it('renders nothing at all when no run has failed', () => {
    const { container } = render(<ActionFailureSheet />);
    expect(container.textContent).toBe('');
  });

  it('gives each accessory its own name and its own reason', () => {
    // Two different faults under one toast line — a bulb that timed out and one
    // that is off at the wall. Telling them apart is the point of the sheet.
    open([
      failure('a', 'Hall Lamp', 'Hall Lamp didn’t respond in time.'),
      failure('b', 'Porch Light', 'Couldn’t reach Porch Light — your home isn’t connected.'),
    ]);

    expect(screen.getByText('Hall Lamp')).toBeTruthy();
    expect(screen.getByText('Hall Lamp didn’t respond in time.')).toBeTruthy();
    expect(screen.getByText('Porch Light')).toBeTruthy();
    expect(screen.getByText('Couldn’t reach Porch Light — your home isn’t connected.')).toBeTruthy();
  });

  it('retries one accessory on its own row', () => {
    const { retry } = open([
      failure('a', 'Hall Lamp', 'Didn’t respond in time.'),
      failure('b', 'Porch Light', 'Didn’t respond in time.'),
    ]);

    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[1]);

    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0].map((f: ActionFailure) => f.accessoryId)).toEqual(['b']);
  });

  it('offers Retry all only when there is more than one to retry', () => {
    open([failure('a', 'Hall Lamp', 'Didn’t respond in time.')]);
    expect(screen.queryByRole('button', { name: /Retry all/ })).toBeNull();

    cleanup();
    closeActionFailures();
    const { retry } = open([
      failure('a', 'Hall Lamp', 'Didn’t respond in time.'),
      failure('b', 'Porch Light', 'Didn’t respond in time.'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry all 2' }));
    expect(retry.mock.calls[0][0]).toHaveLength(2);
  });

  it('falls back to the id when the action carried no name', () => {
    // Only the power actions populate `name`; a blank row would be worse than
    // an ugly one.
    open([{ accessoryId: 'ABC-123', reason: 'Didn’t respond in time.', write: write('ABC-123') }]);
    expect(screen.getByText('ABC-123')).toBeTruthy();
  });

  it('closes the store when it is dismissed', () => {
    open([failure('a', 'Hall Lamp', 'Didn’t respond in time.')]);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText('Hall Lamp')).toBeNull();
  });
});
