// @vitest-environment jsdom
//
// A window that stopped being recorded partway through — the power-cut shape
// from homecast-cloud#66.
//
// History records on CHANGE, so "no samples" normally means "the value did not
// move". It means the opposite when the relay was down: nothing was watching.
// The chart cannot tell the two apart from the points alone, which is why the
// server has to say which stretches it was not recording (`gaps`).
import { cloneElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { HistoryPointData } from '@/lib/graphql/types';

// ResponsiveContainer measures its parent, and jsdom reports 0×0 — nothing is
// laid out and every path is empty. Hand the chart a fixed size instead so the
// curve is really drawn.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 800, height: 200 }),
  };
});

import HistoryChart from '../HistoryChart';

const HOUR = 3_600_000;
const FROM = Date.UTC(2026, 8, 4, 5, 30);
const TO = FROM + 24 * HOUR;
const CUT_FROM = Date.UTC(2026, 8, 4, 10, 0);
const CUT_TO = Date.UTC(2026, 8, 4, 19, 0);
const CUT = [{ fromTs: CUT_FROM, toTs: CUT_TO }];

/** 05:30 → 05:30 next day, sampled every 6 minutes, with a hole 10:00–19:00. */
function powerCutDay(): HistoryPointData[] {
  const points: HistoryPointData[] = [];
  for (let ts = FROM; ts < TO; ts += 6 * 60_000) {
    if (ts >= CUT_FROM && ts < CUT_TO) continue; // the relay was off
    const v = 18 + ((ts / 60_000) % 7) * 0.5;
    points.push({ ts, min: v, avg: v, max: v, last: v, count: 1 });
  }
  return points;
}

/** Subpath starts in the drawn average curve. One = an unbroken line. */
function curveBreaks(container: HTMLElement): number {
  const path = container.querySelector<SVGPathElement>('.recharts-area-curve');
  const d = path?.getAttribute('d') ?? '';
  expect(d).not.toBe(''); // the chart really drew something
  return (d.match(/M/g) ?? []).length;
}

describe('HistoryChart across an unrecorded stretch', () => {
  it('says nothing about a hole the server has not vouched for', () => {
    // No `gaps` — an older server, or the Community resolver. A hole is then
    // just a value that did not move, which is what it usually is, and the
    // chart behaves exactly as it always did.
    const { container } = render(
      <HistoryChart points={powerCutDay()} unit="°" gradientId="g" fromTs={FROM} toTs={TO} />,
    );
    expect(curveBreaks(container)).toBe(1);
    expect(container.textContent).not.toContain('Not recorded');
  });

  it('breaks the line and says so where the home recorded nothing', () => {
    const { container } = render(
      <HistoryChart
        points={powerCutDay()} gaps={CUT} unit="°" gradientId="g" fromTs={FROM} toTs={TO}
      />,
    );
    // Two subpaths: before the cut and after it. Nothing is drawn across it,
    // so the nine hours can no longer be read as a steady 18°.
    expect(curveBreaks(container)).toBe(2);
    expect(container.textContent).toContain('Not recorded');
  });

  it('will not blank out a stretch that has readings in it', () => {
    // The gap is the server's claim; a point inside it is proof to the
    // contrary, and the point wins.
    const { container } = render(
      <HistoryChart
        points={powerCutDay()}
        gaps={[{ fromTs: FROM + HOUR, toTs: TO }]}
        unit="°" gradientId="g" fromTs={FROM} toTs={TO}
      />,
    );
    expect(curveBreaks(container)).toBe(1);
    expect(container.textContent).not.toContain('Not recorded');
  });

  it('does not hold the last reading out across an outage that is still running', () => {
    // The chart runs its final value to the right edge so a line ending
    // mid-panel does not read as a rendering bug. Doing that here would hold a
    // stale reading across the very stretch we are refusing to assert.
    const points = powerCutDay().filter(p => p.ts < CUT_FROM);
    const { container } = render(
      <HistoryChart
        points={points} gaps={[{ fromTs: CUT_FROM, toTs: TO }]}
        unit="°" gradientId="g" fromTs={FROM} toTs={TO}
      />,
    );
    const d = container.querySelector('.recharts-area-curve')?.getAttribute('d') ?? '';
    // The x axis spans the full window; the curve must stop well short of its
    // right edge rather than running the whole width.
    const xs = [...d.matchAll(/[ML](-?[\d.]+),/g)].map(m => Number(m[1]));
    expect(Math.max(...xs)).toBeLessThan(500); // full width is 800
    expect(curveBreaks(container)).toBe(1);
  });

  it('leaves the sparkline unlabelled', () => {
    // 60px of chart has no room for a caption, and the widget face is not the
    // place to explain an outage.
    const { container } = render(
      <HistoryChart points={powerCutDay()} gaps={CUT} unit="°" gradientId="g" sparkline
        fromTs={FROM} toTs={TO} />,
    );
    expect(container.textContent).not.toContain('Not recorded');
  });
});
