// @vitest-environment jsdom
//
// The reuse this whole cache exists for: a room's series, still held when the
// house asks for them as part of a wider set.
//
// MockedProvider is the assertion. It answers each mocked request exactly
// once and errors on anything unmocked, so "only the new accessory is
// requested" is proved by supplying a mock for only the new accessory — an
// over-fetch fails the test rather than merely being slower.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { ReactNode } from 'react';
import { useMultiSeriesHistory } from '../useMultiSeriesHistory';
import { GET_HISTORY } from '@/lib/graphql/queries';
import { __resetSeriesCacheForTests } from '@/history/seriesCache';

const HOUR = 3_600_000;
const TYPE = 'current_temperature';
const FROM = 0;
const TO = HOUR;

const answer = (accessoryIds: string[]) => ({
  request: {
    query: GET_HISTORY,
    variables: {
      homeId: 'HOME-1',
      series: accessoryIds.map(accessoryId => ({ accessoryId, characteristicType: TYPE })),
      fromTs: FROM,
      toTs: TO,
      maxPoints: 500,
    },
  },
  result: {
    data: {
      history: accessoryIds.map(accessoryId => ({
        accessoryId,
        characteristicType: TYPE,
        kind: 'numeric',
        unit: '°',
        resolution: 'raw',
        prevValue: 20,
        prevValueText: null,
        points: [{ ts: 0, min: 20, avg: 20, max: 20, last: 20, count: 1 }],
        states: [],
        stateBuckets: [],
      })),
    },
  },
});

const refs = (accessoryIds: string[]) =>
  accessoryIds.map(accessoryId => ({ accessoryId, characteristicType: TYPE }));

function wrapperWith(mocks: ReturnType<typeof answer>[]) {
  return ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks}>{children}</MockedProvider>
  );
}

const render = (accessoryIds: string[], mocks: ReturnType<typeof answer>[]) =>
  renderHook(
    () => useMultiSeriesHistory('HOME-1', refs(accessoryIds), FROM, TO, false),
    { wrapper: wrapperWith(mocks) },
  );

beforeEach(() => {
  __resetSeriesCacheForTests();
});

describe('useMultiSeriesHistory — the series cache', () => {
  it('asks the house only for what the room did not already fetch', async () => {
    const room = render(['ACC-A'], [answer(['ACC-A'])]);
    await waitFor(() => expect(room.result.current.data.size).toBe(1));
    room.unmount();

    // Only ACC-B is mocked. Re-requesting ACC-A would find no mock and fail.
    const house = render(['ACC-A', 'ACC-B'], [answer(['ACC-B'])]);
    await waitFor(() => expect(house.result.current.data.size).toBe(2));
    expect(house.result.current.data.get(`ACC-A|${TYPE}`)).toBeTruthy();
    expect(house.result.current.data.get(`ACC-B|${TYPE}`)).toBeTruthy();
  });

  it('paints held series on the very first frame, with no network at all', async () => {
    const first = render(['ACC-A'], [answer(['ACC-A'])]);
    await waitFor(() => expect(first.result.current.data.size).toBe(1));
    first.unmount();

    // No mocks: any query would throw. A scope change remounts this hook, so
    // seeding from the cache during render is what avoids a skeleton frame.
    const again = render(['ACC-A'], []);
    expect(again.result.current.data.size).toBe(1);
    expect(again.result.current.loading).toBe(false);
    await waitFor(() =>
      expect(again.result.current.progress).toEqual({ done: 1, total: 1 }));
    expect(again.result.current.error).toBeNull();
  });

  it('counts held series as done, so progress stays a fact', async () => {
    const room = render(['ACC-A'], [answer(['ACC-A'])]);
    await waitFor(() => expect(room.result.current.data.size).toBe(1));
    room.unmount();

    const house = render(['ACC-A', 'ACC-B'], [answer(['ACC-B'])]);
    await waitFor(() => expect(house.result.current.data.size).toBe(2));
    // Not "1 of 2" — one of them never had to be asked for.
    expect(house.result.current.progress).toEqual({ done: 2, total: 2 });
  });

  it('refetches once the window moves, which is what Refresh changes', async () => {
    const first = render(['ACC-A'], [answer(['ACC-A'])]);
    await waitFor(() => expect(first.result.current.data.size).toBe(1));
    first.unmount();

    const moved = renderHook(
      () => useMultiSeriesHistory('HOME-1', refs(['ACC-A']), FROM + 1, TO + 1, false),
      {
        wrapper: wrapperWith([{
          ...answer(['ACC-A']),
          request: {
            ...answer(['ACC-A']).request,
            variables: { ...answer(['ACC-A']).request.variables, fromTs: FROM + 1, toTs: TO + 1 },
          },
        }]),
      },
    );
    // A different window is a different question; the held answer must not
    // be served for it.
    await waitFor(() => expect(moved.result.current.data.size).toBe(1));
    expect(moved.result.current.error).toBeNull();
  });
});
