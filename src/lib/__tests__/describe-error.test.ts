// "[object Object]" is what an automation's execution history showed for every
// HomeKit failure it ever had. The native bridge rejects with a plain object —
// Swift's sendError posts {code, message} and the injected shim rejects with it
// verbatim — so `String(e)` stringified an object and threw away the two fields
// that said what went wrong.
//
// These tests pin the contract rather than a phrasing: whatever is thrown, the
// result is non-empty, is not "[object Object]", and keeps the code.

import { describe, it, expect } from 'vitest';
import { describeError, errorCode, describeWriteFailure } from '../describe-error';

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

  it('keeps a specific refusal rather than replacing it with generic prose', () => {
    // An accessory that refused the write has something worth reading.
    const refused = { code: 'CHARACTERISTIC_NOT_WRITABLE', message: 'Characteristic is not writable' };
    expect(describeWriteFailure(refused, 'Lamp')).toBe(describeError(refused));
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
