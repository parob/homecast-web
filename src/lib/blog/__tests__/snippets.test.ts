/**
 * The code in the posts, run.
 *
 * A guide that tells people to paste a Code node is only as good as that code.
 * Each block marked `<!-- snippet: name -->` in a post is pulled out of the
 * markdown here — the published text, not a copy — and executed the way
 * CodeSandbox runs it, `new Function('input', code)`, against real API
 * responses recorded into fixtures/. If someone edits a snippet in the post,
 * this is what notices.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ExpressionEngine } from '@/automation/expression/ExpressionEngine';
import planned from './fixtures/tfl-sevenoaks-blackfriars-journeys.json';
import forecast from './fixtures/open-meteo-sevenoaks.json';

const contentDir = path.resolve(__dirname, '../../../../content/blog');

/** Every `<!-- snippet: name -->` code block across the posts. */
function readSnippets(): Record<string, string> {
  const snippets: Record<string, string> = {};
  for (const file of fs.readdirSync(contentDir).filter((f) => f.endsWith('.md'))) {
    const md = fs.readFileSync(path.join(contentDir, file), 'utf-8');
    for (const m of md.matchAll(/<!-- snippet: ([\w-]+) -->\s*```[a-z]*\n([\s\S]*?)```/g)) {
      snippets[m[1]] = m[2];
    }
  }
  return snippets;
}

const snippets = readSnippets();

/** Run a Code-node snippet with the given upstream HTTP response, as the sandbox would. */
function runCode(name: string, body: unknown): Record<string, unknown> {
  const code = snippets[name];
  if (!code) throw new Error(`no snippet "${name}" in content/blog`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('input', `"use strict";\n${code}`);
  return fn({ nodes: { schedule1: { data: { type: 'time_pattern' } }, http1: { data: { status: 200, ok: true, body } } } });
}

afterEach(() => { vi.useRealTimers(); });

// The recorded plan is from October, so its zone-less London times are BST.
type Plan = typeof planned;
const bst = (t: string) => Date.parse(`${t}+01:00`);
const firstLeg = planned.journeys[0].legs[0];
const first = bst(firstLeg.departureTime);
const at = (msFromFirst: number, base = first) => { vi.useFakeTimers(); vi.setSystemTime(base + msFromFirst); };
const min = 60_000;
const leaves = firstLeg.scheduledDepartureTime.slice(11, 16);
const arrives = planned.journeys[0].arrivalDateTime.slice(11, 16);
const clone = (): Plan => JSON.parse(JSON.stringify(planned));

describe('train-light snippet (WALK 7, BUFFER 2, PATIENCE 6, LATE 10)', () => {
  it('is full green when you would arrive with exactly BUFFER minutes in hand', () => {
    at(-(7 + 2) * min);
    expect(runCode('train-light', planned)).toMatchObject({
      colour: 'green', hue: 120, saturation: 100, brightness: 100,
      summary: `Go now for the ${leaves}, in at ${arrives}`,
    });
  });

  it('is dimmer green when you would wait a little longer than ideal', () => {
    at(-(7 + 4) * min);
    expect(runCode('train-light', planned)).toMatchObject({ colour: 'green', brightness: 65 });
  });

  it('goes amber when you would only be waiting on the platform, brighter the longer the wait', () => {
    at(-(7 + 10) * min);
    const soon = runCode('train-light', planned);
    at(-(7 + 20) * min);
    const later = runCode('train-light', planned);
    expect(soon).toMatchObject({ colour: 'amber', hue: 35, summary: `Leave in 8 min for the ${leaves}, in at ${arrives}` });
    expect(later.colour).toBe('amber');
    expect(later.brightness as number).toBeGreaterThan(soon.brightness as number);
  });

  it('moves on to the next journey once this one is out of reach', () => {
    at(-(7 - 1) * min); // the first train leaves in 6 minutes; the walk is 7
    const next = planned.journeys[1];
    expect(runCode('train-light', planned).summary)
      .toContain(`the ${next.legs[0].scheduledDepartureTime.slice(11, 16)}, in at ${next.arrivalDateTime.slice(11, 16)}`);
  });

  it('aims for the train as it is running, not as it was timetabled', () => {
    // The second journey's first train is running a few minutes late in the
    // recording: leaving at its expected time should be the full-green moment.
    const next = planned.journeys[1].legs[0];
    expect(bst(next.departureTime)).toBeGreaterThan(bst(next.scheduledDepartureTime));
    at(-(7 + 2) * min, bst(next.departureTime));
    expect(runCode('train-light', { journeys: [planned.journeys[1]] })).toMatchObject({ colour: 'green', brightness: 100 });
  });

  it('is red when your train is leaving LATE minutes or more late', () => {
    at(-20 * min);
    const plan = clone();
    plan.journeys[0].legs[0].departureTime = new Date(first + 12 * min + 3600_000).toISOString().slice(0, 19);
    expect(runCode('train-light', plan)).toMatchObject({ colour: 'red', hue: 0, summary: `The ${leaves} is running 12 min late` });
  });

  it('is red when the journey will get in LATE minutes or more late', () => {
    at(-20 * min);
    const plan = clone();
    const last = plan.journeys[0].legs[plan.journeys[0].legs.length - 1];
    last.arrivalTime = new Date(bst(last.scheduledArrivalTime) + 11 * min + 3600_000).toISOString().slice(0, 19);
    expect(runCode('train-light', plan)).toMatchObject({ colour: 'red', summary: `The ${leaves} is running 11 min late` });
  });

  it('is red with nothing to catch, and never throws on an empty answer', () => {
    at(0);
    expect(runCode('train-light', { journeys: [] })).toMatchObject({ colour: 'red', summary: 'No trains to catch in the next 90 minutes' });
    expect(runCode('train-light', {}).colour).toBe('red');
  });

  it('reads London time correctly in winter too', () => {
    // Same clock times in December are GMT, an hour later in UTC than in October.
    const winter: Plan = JSON.parse(JSON.stringify(planned).replace(/2026-10-05T/g, '2026-12-07T'));
    at(-(7 + 2) * min, Date.parse(`2026-12-07T${firstLeg.departureTime.slice(11)}Z`));
    expect(runCode('train-light', winter)).toMatchObject({ colour: 'green', brightness: 100 });
  });

  it('only ever asks a light for values it can take', () => {
    for (let m = -120; m <= 60; m += 1) {
      at(m * min);
      const r = runCode('train-light', planned);
      expect(r.brightness as number).toBeGreaterThanOrEqual(30);
      expect(r.brightness as number).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.brightness)).toBe(true);
      expect([0, 35, 120]).toContain(r.hue);
    }
  });
});

describe('umbrella snippet', () => {
  it('stays quiet on a dry day', () => {
    const dry = { ...forecast, hourly: { ...forecast.hourly, precipitation_probability: forecast.hourly.time.map(() => 10) } };
    expect(runCode('umbrella', dry)).toMatchObject({ rain: false, chance: 10 });
  });

  it('reports the wettest hour of the working day, ignoring the night', () => {
    const chance = forecast.hourly.time.map((t: string) => (t.endsWith('T17:00') ? 70 : t.endsWith('T03:00') ? 95 : 5));
    expect(runCode('umbrella', { ...forecast, hourly: { ...forecast.hourly, precipitation_probability: chance } }))
      .toEqual({ rain: true, chance: 70, at: '17:00' });
  });
});

describe('commute-hours IF expression', () => {
  const engine = new ExpressionEngine();
  const check = (date: Date) => {
    vi.useFakeTimers();
    vi.setSystemTime(date);
    const ctx = ExpressionEngine.buildContext({} as never, { type: 'time_pattern', timestamp: Date.now() } as never, {});
    return engine.evaluateBoolean(snippets['commute-hours'].trim(), ctx);
  };

  it('passes on a weekday morning between 7 and 9, local time', () => {
    expect(check(new Date(2026, 9, 5, 7, 0))).toBe(true);   // Monday 07:00
    expect(check(new Date(2026, 9, 9, 8, 59))).toBe(true);  // Friday 08:59
  });

  it('fails outside the window and at weekends', () => {
    expect(check(new Date(2026, 9, 5, 6, 59))).toBe(false);
    expect(check(new Date(2026, 9, 5, 9, 0))).toBe(false);
    expect(check(new Date(2026, 9, 10, 8, 0))).toBe(false); // Saturday
  });
});
