// The bug being pinned: a shared page that renders "Not Found — this link is
// invalid or no longer shared" whenever `error` is truthy tells a viewer on
// weak mobile data that their working link is dead, and offers no retry.
//
// So the contract is asymmetric on purpose: claiming "gone" requires the
// server to have actually said so.

import { describe, it, expect } from 'vitest';
import { CombinedGraphQLErrors, CombinedProtocolErrors, ServerError } from '@apollo/client/errors';
import { serverAnswered, isTransportError } from '../graphql-errors';

describe('serverAnswered', () => {
  it('is true for GraphQL errors — the server reached a verdict', () => {
    const err = new CombinedGraphQLErrors({ errors: [{ message: 'Share not found' }] });
    expect(serverAnswered(err)).toBe(true);
    expect(isTransportError(err)).toBe(false);
  });

  it('is true for protocol errors', () => {
    const err = new CombinedProtocolErrors([{ message: 'protocol' }]);
    expect(serverAnswered(err)).toBe(true);
  });

  it('is false when nothing failed', () => {
    expect(serverAnswered(undefined)).toBe(false);
    expect(serverAnswered(null)).toBe(false);
    expect(isTransportError(undefined)).toBe(false);
    expect(isTransportError(null)).toBe(false);
  });
});

describe('isTransportError', () => {
  // These are the shapes a weak connection actually produces.
  it('treats a failed fetch as transport, not as an answer', () => {
    expect(isTransportError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats the 15s client abort as transport', () => {
    // apollo.ts aborts every request at GRAPHQL_REQUEST_TIMEOUT_MS.
    const abort = new DOMException('signal is aborted without reason', 'AbortError');
    expect(isTransportError(abort)).toBe(true);
  });

  it('treats a broken/overloaded server as transport, not as "the share is gone"', () => {
    // A 502 from the LB says nothing about whether the share still exists.
    const err = new ServerError('Response not successful: Received status code 502', {
      response: new Response(null, { status: 502 }),
      bodyText: '<html>502</html>',
    });
    expect(isTransportError(err)).toBe(true);
    expect(serverAnswered(err)).toBe(false);
  });

  it('treats an unrecognised throw as transport rather than as a verdict', () => {
    // Unknown shape: default to the answer that does not destroy a live link.
    expect(isTransportError(new Error('something odd'))).toBe(true);
    expect(isTransportError('a string')).toBe(true);
  });
});
