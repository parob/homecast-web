// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import StatusHistorySections from '../StatusHistorySections';
import { buildStatusCategories } from '@/history/status-series';
import { GET_HISTORY } from '@/lib/graphql/queries';
import type { AggregatedSensorData, SensorReading } from '@/hooks/useSensorAggregation';

// ECharts needs a real canvas; the split-apart view only has to prove it
// hands the right lines over, which the stub reports as text.
vi.mock('../EChartsTimeChart', () => ({
  default: ({ series, bandLabel }: { series: Array<{ label: string }>; bandLabel?: string }) => (
    <div data-testid="echarts">
      {series.map(s => <span key={s.label}>{s.label}</span>)}
      <span>band:{bandLabel}</span>
    </div>
  ),
}));

// Recharts measures its container; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const HOUR = 3_600_000;

/**
 * Mock mode never issues a query, but useMultiSeriesHistory still asks for
 * the client on the way past — so a provider with no mocks is enough.
 */
function renderSections(props: Parameters<typeof StatusHistorySections>[0]) {
  return render(
    <MockedProvider mocks={[]}>
      <StatusHistorySections {...props} />
    </MockedProvider>,
  );
}

function reading(
  accessoryId: string,
  characteristicType: string,
  accessoryName = accessoryId,
  roomName?: string,
): SensorReading {
  return { accessoryId, accessoryName, value: 0, characteristicType, roomName };
}

const EMPTY: AggregatedSensorData = {
  temperature: null, humidity: null, motion: null,
  locks: null, contacts: null, lowBattery: null, hasData: false,
};

/** Two of the mock catalogue's temperature sensors, plus a door contact. */
const CATEGORIES = buildStatusCategories({
  ...EMPTY,
  temperature: {
    avg: 21, min: 20.8, max: 21.2,
    readings: [
      reading('MOCK-LR-SENSOR', 'current_temperature', 'Living Room Sensor', 'Living Room'),
      reading('MOCK-LR-SENSOR2', 'current_temperature', 'Bookshelf Sensor', 'Living Room'),
    ],
  },
  contacts: {
    openCount: 0, closedCount: 1,
    readings: [reading('MOCK-DOOR', 'contact_state', 'Front Door', 'Hallway')],
  },
  hasData: true,
});

describe('StatusHistorySections', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('draws one aggregate panel per category, in bubble order', async () => {
    const toTs = 1_700_000_000_000;
    renderSections({
      homeId: 'MOCK-HOME',
      mock: true,
      categories: CATEGORIES,
      fromTs: toTs - 24 * HOUR,
      toTs,
    });

    await waitFor(() => expect(screen.getByText('Temperature')).toBeTruthy());
    expect(screen.getByText('Contacts')).toBeTruthy();

    // Numeric: an average across the sensors, with the spread behind it.
    expect(screen.getByText('average of 2 sensors · shaded = spread')).toBeTruthy();
    expect(screen.getByText(/^min .* · avg .* · max /)).toBeTruthy();

    // State: how many are open, phrased from the category, not "on".
    expect(screen.getByText('how many of 1 are open')).toBeTruthy();
    expect(screen.getByText(/^open for .* in total · \d+ changes?$/)).toBeTruthy();
  });

  it('can split an average into a line per sensor, over the same band', async () => {
    const toTs = 1_700_000_000_000;
    renderSections({
      homeId: 'MOCK-HOME',
      mock: true,
      categories: CATEGORIES,
      fromTs: toTs - 24 * HOUR,
      toTs,
    });

    await waitFor(() => expect(screen.getByText('Temperature')).toBeTruthy());
    // Two temperature sensors can be split; the lone contact sensor cannot.
    const buttons = screen.getAllByRole('button', { name: 'Separate' });
    expect(buttons).toHaveLength(1);

    await act(async () => {
      fireEvent.click(buttons[0]);
    });

    const chart = await screen.findByTestId('echarts');
    expect(chart.textContent).toContain('band:average');
    // Named by accessory, trimmed to what tells them apart — the same
    // shortening the Analytics legend uses: "Living Room Sensor" in the
    // Living Room is "Sensor", and the shared "Sensor" token drops off the
    // other one.
    expect(chart.textContent).toContain('Sensor');
    expect(chart.textContent).toContain('Bookshelf');
    // And it goes back.
    expect(screen.getByRole('button', { name: 'Combine' })).toBeTruthy();
  });

  it('says so when it had to leave sensors out', async () => {
    const truncated = CATEGORIES.map(c => (
      c.key === 'temperature' ? { ...c, truncated: 3 } : c
    ));
    const toTs = 1_700_000_000_000;
    renderSections({
      homeId: 'MOCK-HOME',
      mock: true,
      categories: truncated,
      fromTs: toTs - 24 * HOUR,
      toTs,
    });

    await waitFor(() =>
      expect(screen.getByText(/3 more sensors not charted/)).toBeTruthy());
  });

  it('says nothing is recorded rather than drawing an empty chart', async () => {
    // The real fetch path this time, answering with a home that has recorded
    // nothing for these sensors yet.
    const categories = buildStatusCategories({
      ...EMPTY,
      temperature: { avg: 21, min: 21, max: 21, readings: [reading('ACC-A', 'current_temperature')] },
      hasData: true,
    });

    render(
      <MockedProvider mocks={[{
        request: {
          query: GET_HISTORY,
          variables: {
            homeId: 'HOME-1',
            series: [{ accessoryId: 'ACC-A', characteristicType: 'current_temperature' }],
            fromTs: 0,
            toTs: HOUR,
            maxPoints: 500,
          },
        },
        result: { data: { history: [] } },
      }]}>
        <StatusHistorySections
          homeId="HOME-1"
          mock={false}
          categories={categories}
          fromTs={0}
          toTs={HOUR}
        />
      </MockedProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/Nothing recorded for this range yet/)).toBeTruthy());
  });

  it('asks each home for its own sensors when a view spans several', async () => {
    // A collection can hold accessories from more than one home, and
    // GetHistory takes one home — so this must be two queries, not one.
    const categories = buildStatusCategories({
      ...EMPTY,
      temperature: {
        avg: 21, min: 21, max: 21,
        readings: [
          { ...reading('ACC-A', 'current_temperature'), homeId: 'HOME-1' },
          { ...reading('ACC-B', 'current_temperature'), homeId: 'HOME-2' },
        ],
      },
      hasData: true,
    });

    const answer = (homeId: string, accessoryId: string) => ({
      request: {
        query: GET_HISTORY,
        variables: {
          homeId,
          series: [{ accessoryId, characteristicType: 'current_temperature' }],
          fromTs: 0,
          toTs: HOUR,
          maxPoints: 500,
        },
      },
      result: {
        data: {
          history: [{
            accessoryId,
            characteristicType: 'current_temperature',
            kind: 'numeric',
            unit: '°',
            resolution: 'raw',
            prevValue: 20,
            prevValueText: null,
            points: [{ ts: 0, min: 20, avg: 20, max: 20, last: 20, count: 1 }],
            states: [],
            stateBuckets: [],
          }],
        },
      },
    });

    render(
      <MockedProvider mocks={[answer('HOME-1', 'ACC-A'), answer('HOME-2', 'ACC-B')]}>
        <StatusHistorySections
          homeId={null}
          mock={false}
          categories={categories}
          fromTs={0}
          toTs={HOUR}
        />
      </MockedProvider>,
    );

    // Both answers landed, so both sensors are in the average.
    await waitFor(() =>
      expect(screen.getByText('average of 2 sensors · shaded = spread')).toBeTruthy());
  });
});
