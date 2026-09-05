// @vitest-environment jsdom
//
// The power-cut day, drawn both ways — and, with SHOT_DIR set, dumped as SVG
// so the difference can be looked at rather than described:
//
//   SHOT_DIR=/tmp/shots npx vitest run src/components/widgets/__tests__/history-chart-shot.test.tsx
//
// The assertions hold either way; the dump is the by-product that makes a
// before/after picture cheap enough to put in a review.
import { cloneElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { writeFileSync } from 'node:fs';
import type { HistoryPointData } from '@/lib/graphql/types';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 720, height: 220 }),
  };
});

import HistoryChart from '../HistoryChart';

const HOUR = 3_600_000;
const FROM = Date.UTC(2026, 8, 4, 5, 30);
const TO = FROM + 24 * HOUR;
const CUT = [{ fromTs: Date.UTC(2026, 8, 4, 10, 0), toTs: Date.UTC(2026, 8, 4, 19, 0) }];

/** The reported shape: a lively AC sensor with 10:00–19:00 missing. */
function powerCutDay(): HistoryPointData[] {
  const points: HistoryPointData[] = [];
  for (let ts = FROM; ts < TO; ts += 6 * 60_000) {
    if (ts >= CUT[0].fromTs && ts < CUT[0].toTs) continue;
    const m = ts / 60_000;
    const v = 18 + (Math.sin(m / 7) > 0.2 ? 1 : 0) * (1.5 + Math.sin(m / 23) * 1.4);
    points.push({ ts, min: v, avg: v, max: v, last: v, count: 1 });
  }
  return points;
}

const CSS = `
  svg { background: #fff; font-family: ui-sans-serif, system-ui, sans-serif; color: #2563eb; }
  .stroke-border { stroke: #e5e7eb; }
  .text-muted-foreground, .fill-muted-foreground { fill: #64748b; }
  .recharts-cartesian-axis-tick text { fill: #64748b; }
`;

/** Renders, optionally writes the SVG out, and returns the average curve. */
function draw(name: string, node: React.ReactElement): string {
  const { container } = render(node);
  const svg = container.querySelector('svg')!;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const dir = process.env.SHOT_DIR;
  if (dir) writeFileSync(`${dir}/${name}.svg`, `<style>${CSS}</style>\n${svg.outerHTML}`);
  return container.querySelector('.recharts-area-curve')?.getAttribute('d') ?? '';
}

describe('power-cut day, as drawn', () => {
  it('before: one line straight through the outage', () => {
    const d = draw('before', <HistoryChart points={powerCutDay()} unit="°" gradientId="a" fromTs={FROM} toTs={TO} />);
    expect(d.match(/M/g)).toHaveLength(1);
  });

  it('after: the line stops where the recording did', () => {
    const d = draw('after', <HistoryChart points={powerCutDay()} gaps={CUT} unit="°" gradientId="b" fromTs={FROM} toTs={TO} />);
    expect(d.match(/M/g)).toHaveLength(2);
  });
});
