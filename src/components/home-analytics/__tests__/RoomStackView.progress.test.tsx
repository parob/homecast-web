// @vitest-environment jsdom
//
// Caching made "there is data" stop meaning "we are done".
//
// The skeleton — and the progress bar that lived inside it — was gated on
// `loading && data.size === 0`. Once a room's series are held, opening the
// whole house arrives with content already painted, so that gate went false
// while ~194 series were still in flight and the view reported nothing at all.
// Charts just filled themselves in silently.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import RoomStackView from '../RoomStackView';
import { GET_HISTORY } from '@/lib/graphql/queries';
import {
  seriesCacheKey,
  seriesCacheGeneration,
  setCachedSeries,
  __resetSeriesCacheForTests,
} from '@/history/seriesCache';
import type { AccessoryInfoEntry } from '@/history/categories';
import type { HistorySeriesInfo, HistorySeriesData } from '@/lib/graphql/types';

// ECharts wants a real canvas; this view only has to prove what it reports.
vi.mock('../EChartsTimeChart', () => ({
  default: () => <div data-testid="echarts" />,
}));

const HOME = 'HOME-1';
const TYPE = 'current_temperature';
const RANGE = 24 * 3_600_000;
const WINDOW_END = 1_700_000_100_000;
const FROM = WINDOW_END - RANGE;

const info = (accessoryId: string, characteristicType = TYPE) => ({
  accessoryId, characteristicType, enabled: true, kind: 'numeric', unit: '°',
} as unknown as HistorySeriesInfo);

const answer = (accessoryId: string): HistorySeriesData => ({
  accessoryId,
  characteristicType: TYPE,
  kind: 'numeric',
  unit: '°',
  resolution: 'raw',
  prevValue: 20,
  prevValueText: null,
  points: [{ ts: FROM + 1000, min: 20, avg: 20, max: 20, last: 20, count: 1 }],
  states: [],
  stateBuckets: [],
}) as unknown as HistorySeriesData;

/** A query that never settles, so the view stays mid-load for the assertion. */
const neverAnswers = (...accessoryIds: string[]) => ({
  request: {
    query: GET_HISTORY,
    variables: {
      homeId: HOME,
      series: accessoryIds.map(accessoryId => ({ accessoryId, characteristicType: TYPE })),
      fromTs: FROM, toTs: WINDOW_END, maxPoints: 500,
    },
  },
  delay: 1_000_000,
  result: { data: { history: [] } },
});

beforeEach(() => __resetSeriesCacheForTests());
afterEach(cleanup);

const renderHouse = (mocks: ReturnType<typeof neverAnswers>[]) => render(
  <MockedProvider mocks={mocks}>
    <RoomStackView
      homeId={HOME}
      mock={false}
      roomSeries={[info('ACC-A'), info('ACC-B')]}
      room={null}
      accessoryInfo={new Map<string, AccessoryInfoEntry>([
        ['ACC-A', { name: 'Kitchen Sensor', room: 'Kitchen' } as AccessoryInfoEntry],
        ['ACC-B', { name: 'Hall Sensor', room: 'Hall' } as AccessoryInfoEntry],
      ])}
      groups={[]}
      settings={{ rangeMs: RANGE, windowEnd: WINDOW_END }}
    />
  </MockedProvider>,
);

describe('RoomStackView progress while partly cached', () => {
  it('still reports the wait when some series are already held', async () => {
    // Exactly the room -> house journey: ACC-A came from the room view.
    setCachedSeries(
      seriesCacheKey(HOME, 'ACC-A', TYPE, FROM, WINDOW_END, 500),
      answer('ACC-A'),
      seriesCacheGeneration(),
    );

    // Only ACC-B is mocked — asking for ACC-A again would not match.
    renderHouse([neverAnswers('ACC-B')]);

    // One held, one outstanding — and the view has to say so, even though it
    // has something to draw.
    await waitFor(() => expect(screen.getByText('1 of 2 series')).toBeTruthy());
  });

  it('reports the wait from a cold cache too, via the skeleton', async () => {
    renderHouse([neverAnswers('ACC-A', 'ACC-B')]);
    await waitFor(() => expect(screen.getByText('0 of 2 series')).toBeTruthy());
  });
});
