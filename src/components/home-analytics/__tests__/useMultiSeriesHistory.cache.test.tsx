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
import { GraphQLError } from 'graphql';
import { renderHook, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { ReactNode } from 'react';
import { useMultiSeriesHistory } from '../useMultiSeriesHistory';
import { GET_HISTORY, GET_PUBLIC_ENTITY_HISTORY } from '@/lib/graphql/queries';
import { SharedHistoryProvider } from '@/contexts/HistoryContext';
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

function wrapperWith(mocks: Array<ReturnType<typeof answer> & { delay?: number }>) {
  return ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks}>{children}</MockedProvider>
  );
}

const render = (accessoryIds: string[], mocks: Array<ReturnType<typeof answer> & { delay?: number }>) =>
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


describe('analytics batches', () => {
  it('loads sixty series in one request', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `ACC-${i}`);
    const view = render(ids, [answer(ids)]);
    await waitFor(() => expect(view.result.current.data.size).toBe(60));
    expect(view.result.current.progress).toEqual({ done: 60, total: 60 });
  });

  it('shows the first batch while the rest is still loading', async () => {
    const ids = Array.from({ length: 61 }, (_, i) => `ACC-${i}`);
    const view = render(ids, [
      { ...answer(ids.slice(0, 60)), delay: 0 },
      { ...answer(ids.slice(60)), delay: 250 },
    ]);
    await waitFor(() => expect(view.result.current.data.size).toBe(60));
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.progress).toEqual({ done: 60, total: 61 });
    await waitFor(() => expect(view.result.current.data.size).toBe(61));
    expect(view.result.current.loading).toBe(false);
  });

  it('falls back to six-series requests on an older relay', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `ACC-${i}`);
    const rejected = {
      ...answer(ids),
      result: { errors: [new GraphQLError('history queries take 1-6 series')] },
    };
    const view = renderHook(
      () => useMultiSeriesHistory('HOME-1', refs(ids), FROM, TO, false),
      { wrapper: ({ children }) => <MockedProvider mocks={[
        rejected, answer(ids.slice(0, 6)), answer(ids.slice(6)),
      ]}>{children}</MockedProvider> },
    );
    await waitFor(() => expect(view.result.current.data.size).toBe(12));
    expect(view.result.current.error).toBeNull();
  });

  it('does not hide permission errors behind a compatibility retry', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `ACC-${i}`);
    const view = renderHook(
      () => useMultiSeriesHistory('HOME-1', refs(ids), FROM, TO, false),
      { wrapper: ({ children }) => <MockedProvider mocks={[{
        ...answer(ids), result: { errors: [new GraphQLError('Access denied')] },
      }]}>{children}</MockedProvider> },
    );
    await waitFor(() => expect(view.result.current.error).toContain('Access denied'));
    expect(view.result.current.data.size).toBe(0);
  });
});


it('keeps concurrent share requests separate, including their passcodes', async () => {
  const renderShare = (shareHash: string, passcode: string, value: number) => {
    const resultSeries = answer(['ACC-A']).result.data.history[0];
    return renderHook(() => useMultiSeriesHistory('HOME-1', refs(['ACC-A']), FROM, TO, false), {
      wrapper: ({ children }) => <MockedProvider mocks={[{
        request: {
          query: GET_PUBLIC_ENTITY_HISTORY,
          variables: { shareHash, passcode, series: refs(['ACC-A']), fromTs: FROM, toTs: TO, maxPoints: 500 },
        },
        result: { data: { publicEntityHistory: [{ ...resultSeries, prevValue: value }] } },
        delay: 30,
      }]}><SharedHistoryProvider shareHash={shareHash} passcode={passcode} homeId="HOME-1" enabled>
        {children}
      </SharedHistoryProvider></MockedProvider>,
    });
  };
  const a = renderShare('share-a', '1234', 10);
  const b = renderShare('share-b', '1234', 20);
  const c = renderShare('share-a', '5678', 30);
  await waitFor(() => {
    expect(a.result.current.data.get(`ACC-A|${TYPE}`)?.main.prevValue).toBe(10);
    expect(b.result.current.data.get(`ACC-A|${TYPE}`)?.main.prevValue).toBe(20);
    expect(c.result.current.data.get(`ACC-A|${TYPE}`)?.main.prevValue).toBe(30);
  });
});
