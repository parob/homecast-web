// "[object Object]" is what an automation's execution history showed for every
// HomeKit failure it ever had. The native bridge rejects with a plain object —
// Swift's sendError posts {code, message} and the injected shim rejects with it
// verbatim — so `String(e)` stringified an object and threw away the two fields
// that said what went wrong.
//
// These tests pin the contract rather than a phrasing: whatever is thrown, the
// result is non-empty, is not "[object Object]", and keeps the code.

import { describe, it, expect } from 'vitest';
import { describeError, errorCode, describeWriteFailure, isUndecidedWrite } from '../describe-error';

/** Every shape we have actually seen thrown in this codebase. */
const THROWN_SHAPES: [string, unknown][] = [
  ['native bridge rejection', { code: 'CHARACTERISTIC_NOT_WRITABLE', message: 'Characteristic is not writable' }],
  ['native bridge, code only', { code: 'INTERNAL_ERROR' }],
  ['relay ErrorCode throw', Object.assign(new Error('Unknown action: app.reload'), { code: 'UNKNOWN_ACTION' })],
  ['plain Error', new Error('Something broke')],
  ['TypeError', new TypeError('x is not a function')],
  ['string', 'plain string failure'],
  ['null', null],
  ['undefined', undefined],
  ['number', 42],
  ['empty object', {}],
  ['array', [1, 2]],
  ['object with neither code nor message', { detail: 'nope' }],
  ['Error with no message', new Error()],
];

describe('describeError', () => {
  it.each(THROWN_SHAPES)('never produces rubbish for: %s', (_label, thrown) => {
    const described = describeError(thrown);

    expect(described).toBeTruthy();
    expect(described.trim()).not.toBe('');
    expect(described).not.toBe('[object Object]');
    expect(described).not.toContain('[object Object]');
  });

  it('keeps the code alongside the message, which is what a log search keys on', () => {
    expect(describeError({ code: 'ACCESSORY_UNREACHABLE', message: 'Accessory did not respond' }))
      .toBe('Accessory did not respond (ACCESSORY_UNREACHABLE)');
  });

  it('does not repeat a code the message already spells out', () => {
    const e = Object.assign(new Error('Unknown action: app.reload'), { code: 'UNKNOWN_ACTION' });
    // Not "Unknown action: app.reload (UNKNOWN_ACTION)".
    expect(describeError(e)).toBe('Unknown action: app.reload');
  });

  it('falls back to the code when there is no message', () => {
    expect(describeError({ code: 'HOMEKIT_ERROR' })).toBe('HOMEKIT_ERROR');
  });

  it('shows an unrecognised object\'s contents rather than its type', () => {
    expect(describeError({ detail: 'nope' })).toBe('{"detail":"nope"}');
  });

  it('survives a circular object', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    expect(() => describeError(circular)).not.toThrow();
    expect(describeError(circular)).not.toContain('[object Object]');
  });

  it('survives a getter that throws', () => {
    const hostile = { get message(): string { throw new Error('nope'); } };

    expect(() => describeError(hostile)).not.toThrow();
  });

  it('truncates a very long message rather than flooding the trace', () => {
    const described = describeError(new Error('x'.repeat(1000)));

    expect(described.length).toBeLessThanOrEqual(300);
    expect(described.endsWith('…')).toBe(true);
  });

  it('treats a blank message as no message', () => {
    expect(describeError({ message: '   ', code: 'SOME_CODE' })).toBe('SOME_CODE');
    expect(describeError('   ')).toBe('Unknown error');
  });
});

describe('errorCode', () => {
  it('reads the code from a bridge rejection and from an Error', () => {
    expect(errorCode({ code: 'HOMEKIT_ERROR', message: 'x' })).toBe('HOMEKIT_ERROR');
    expect(errorCode(Object.assign(new Error('x'), { code: 'UNKNOWN_ACTION' }))).toBe('UNKNOWN_ACTION');
  });

  it('is undefined when there is no code to branch on', () => {
    expect(errorCode(new Error('x'))).toBeUndefined();
    expect(errorCode('string')).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode({ code: '  ' })).toBeUndefined();
  });
});

// The toast a failed tap produces. The bug being pinned here is that it used to
// read "TIMEOUT: Request timed out: characteristic.set" — the transport action,
// not the thing the user touched.
describe('describeWriteFailure', () => {
  const timeout = { code: 'TIMEOUT', message: 'Request timed out: characteristic.set' };
  const disconnected = { code: 'DISCONNECTED', message: 'WebSocket connection closed' };

  it('names the accessory instead of the transport action', () => {
    const msg = describeWriteFailure(timeout, 'Kitchen Light');
    expect(msg).toContain('Kitchen Light');
    expect(msg).not.toContain('TIMEOUT');
    expect(msg).not.toContain('characteristic.set');
  });

  it('still says something sensible with no accessory name', () => {
    expect(describeWriteFailure(timeout)).toBe("The accessory didn't respond in time.");
    expect(describeWriteFailure(disconnected)).toContain('the accessory');
  });

  it('does not claim a timeout was the connection', () => {
    // We do not know that. The connection indicator answers that question.
    expect(describeWriteFailure(timeout, 'Lamp')).not.toMatch(/connection/i);
  });

  it('says the home is unreachable when that is what happened', () => {
    expect(describeWriteFailure(disconnected, 'Lamp')).toMatch(/isn't connected/);
    expect(describeWriteFailure({ code: 'NO_DEVICE' }, 'Lamp')).toMatch(/isn't connected/);
  });

  it('never leaks an action name or a transport detail', () => {
    // These are the throws a tap makes while the socket is down. Both used to
    // be bare Errors or prose quoting the raw action, so the user saw
    // "WebSocket not connected" or '"characteristic.set" needs Homecast's
    // servers' — the implementation, not the thing they touched.
    const thrown = [
      { code: 'DISCONNECTED', message: 'WebSocket not connected' },
      { code: 'DISCONNECTED', message: 'Not connected to Homecast' },
      { code: 'LOCAL_ONLY', message: '"characteristic.set" needs Homecast\'s servers, and this device can\'t reach them right now.' },
    ];
    for (const e of thrown) {
      const msg = describeWriteFailure(e, 'Kitchen Light');
      expect(msg).toContain('Kitchen Light');
      expect(msg).not.toMatch(/WebSocket|characteristic\.set|DISCONNECTED|LOCAL_ONLY/);
    }
  });

  it('keeps a specific refusal rather than replacing it with generic prose', () => {
    // An accessory that refused the write has something worth reading. The
    // code comes off for the toast — describeError still keeps it for the log.
    const refused = { code: 'CHARACTERISTIC_NOT_WRITABLE', message: 'Characteristic is not writable' };
    expect(describeWriteFailure(refused, 'Lamp')).toBe('Characteristic is not writable');
    expect(describeError(refused)).toContain('CHARACTERISTIC_NOT_WRITABLE');
  });

  // parob/homecast-cloud#28. The lock answered in 87ms, five times, and every
  // one of those answers was replaced with a timeout that had not happened.
  describe('DEVICE_ERROR is an answer, not a silence', () => {
    // Verbatim from the reporter's log buffer, entry id 77.
    const fromRelay = {
      code: 'DEVICE_ERROR',
      message:
        'WRITE_FAILED: Write failed: Aqara Smart Lock U200 did not confirm the write within 10s — it may be unreachable.',
    };

    it('does not claim a device that answered failed to respond', () => {
      expect(describeWriteFailure(fromRelay, 'Aqara Smart Lock U200')).not.toMatch(/respond in time/);
    });

    it('shows the relay its own words, without the machine prefix', () => {
      expect(describeWriteFailure(fromRelay, 'Aqara Smart Lock U200')).toBe(
        'Write failed: Aqara Smart Lock U200 did not confirm the write within 10s — it may be unreachable.',
      );
    });

    it('surfaces guidance the relay went to the trouble of writing', () => {
      // The Apple Home edit-permission case. Reworded, this told the user their
      // lock had not responded — when the truth was that it had, with a reason
      // and a fix. Nothing about "didn't respond in time" would get them there.
      const privileges = {
        code: 'DEVICE_ERROR',
        message:
          "WRITE_FAILED: The relay's Apple ID doesn't have permission to edit this home. Turn on Allow Editing for it in Apple Home.",
      };
      const msg = describeWriteFailure(privileges, 'Aqara Smart Lock U200');
      expect(msg).toContain('Allow Editing');
      expect(msg).not.toMatch(/respond in time|WRITE_FAILED/);
    });

    it('still says nothing it does not know when the cloud itself gave up', () => {
      // TIMEOUT stays on the other side of the line: nothing came back at all.
      expect(describeWriteFailure({ code: 'TIMEOUT', message: 'Device did not respond in time' }, 'Lamp')).toBe(
        "Lamp didn't respond in time.",
      );
    });
  });

  it('never returns an empty string, whatever was thrown', () => {
    for (const [, thrown] of THROWN_SHAPES) {
      expect(describeWriteFailure(thrown, 'Lamp').length).toBeGreaterThan(0);
      expect(describeWriteFailure(thrown)).not.toBe('[object Object]');
    }
  });

  it('ignores a blank accessory name rather than rendering an empty subject', () => {
    expect(describeWriteFailure(timeout, '   ')).toBe("The accessory didn't respond in time.");
  });
});

describe('isUndecidedWrite', () => {
  it('is true when nothing ever came back', () => {
    expect(isUndecidedWrite({ code: 'TIMEOUT', message: 'Request timed out: characteristic.set' })).toBe(true);
  });

  it('is true for the relay saying its own bridge went quiet', () => {
    // A DEVICE_ERROR whose verdict is that there is no verdict — the relay
    // answered, and what it answered was "I do not know". parob/homecast-cloud#62.
    expect(isUndecidedWrite({
      code: 'DEVICE_ERROR',
      message: 'BRIDGE_TIMEOUT: HomeKit bridge did not answer characteristics.set within 15s',
    })).toBe(true);
  });

  it('is false for a DEVICE_ERROR that carries a real reason', () => {
    // #28's line, held: this one answered, and the answer is the useful part.
    expect(isUndecidedWrite({ code: 'DEVICE_ERROR', message: 'Accessory is not responding.' })).toBe(false);
  });

  it('is false for a bulb whose own name says the word', () => {
    // Matched on the relay's code prefix, not on prose anywhere in the message.
    expect(isUndecidedWrite({ code: 'DEVICE_ERROR', message: 'Write failed for BRIDGE_TIMEOUT Lamp' })).toBe(false);
  });

  it('is false for the shapes that are not errors at all', () => {
    expect(isUndecidedWrite(null)).toBe(false);
    expect(isUndecidedWrite('timed out')).toBe(false);
    expect(isUndecidedWrite({ code: 'DISCONNECTED', message: 'offline' })).toBe(false);
  });
});
