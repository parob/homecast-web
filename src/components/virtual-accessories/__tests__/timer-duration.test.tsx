// @vitest-environment jsdom
/**
 * Editing a timer's duration must keep what you typed.
 *
 * The three duration fields are one value split across three inputs, which is
 * exactly where a controlled number input goes wrong: clearing one to retype it
 * is an intermediate state the model has to tolerate, and coercing it to 0 on
 * the way through both fights the typing and loses the edit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VirtualAccessoryEditorDialog } from '../VirtualAccessoryEditorDialog';
import { durationToMs, type VirtualAccessoryDefinition } from '@/automation/types/automation';

afterEach(cleanup);

const TIMER: VirtualAccessoryDefinition = {
  id: 'va-timer-1',
  name: 'Porch Timer',
  type: 'timer',
  homeId: 'HOME-1',
  duration: { hours: 0, minutes: 5, seconds: 5 },
} as VirtualAccessoryDefinition;

function open(
  existing: VirtualAccessoryDefinition,
  onSave = vi.fn(async (_helper: VirtualAccessoryDefinition) => {}),
) {
  render(
    <VirtualAccessoryEditorDialog
      open
      onOpenChange={() => {}}
      homeId="HOME-1"
      homeName="Home"
      existing={existing}
      onSave={onSave}
    />,
  );
  return onSave;
}


/** The saved duration, narrowed off the definition union. */
function savedDuration(onSave: { mock: { calls: VirtualAccessoryDefinition[][] } }) {
  const saved = onSave.mock.calls[0][0];
  if (saved.type !== 'timer') throw new Error(`expected a timer, got ${saved.type}`);
  return saved.duration;
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const done = () => screen.getByRole('button', { name: /save|done/i });

describe('timer duration', () => {
  it('keeps a minutes edit when seconds is left alone', async () => {
    const onSave = open(TIMER);

    fireEvent.change(field('Minutes'), { target: { value: '10' } });
    fireEvent.click(done());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(savedDuration(onSave)).toEqual({ hours: 0, minutes: 10, seconds: 5 });
  });

  it('lets a field be cleared without snapping back to 0 mid-edit', async () => {
    open(TIMER);

    // Clearing is how you retype: the field must stay empty until you type,
    // not refill itself with 0 under the cursor.
    fireEvent.change(field('Seconds'), { target: { value: '' } });
    expect(field('Seconds').value).toBe('');

    fireEvent.change(field('Seconds'), { target: { value: '30' } });
    expect(field('Seconds').value).toBe('30');
  });

  it('treats a cleared field as zero when saved', async () => {
    const onSave = open(TIMER);

    fireEvent.change(field('Seconds'), { target: { value: '' } });
    fireEvent.change(field('Minutes'), { target: { value: '2' } });
    fireEvent.click(done());

    // Asserted through durationToMs rather than on the shape: an absent unit
    // and a zero one are the same duration, and which one is stored is not
    // something the user can see.
    expect(durationToMs(savedDuration(onSave)!)).toBe(2 * 60 * 1000);
  });

  it('does not rewrite a duration the user never touched', async () => {
    const onSave = open(TIMER);

    fireEvent.change(field('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(done());

    expect(durationToMs(savedDuration(onSave)!)).toBe(305_000);
  });
});
