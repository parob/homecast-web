---
title: A lamp that tells you when to leave for the train
description: Use train times to change a lamp's colour, with a quick-walk warning and at least two minutes on the platform.
date: 2026-10-05
category: guide
author: Rob Parker
cover: /blog/apple-home-when-to-leave-light/lamp.webp
coverAlt: A lamp glowing pale green on a hallway shelf
tags: [automations, developers, lights]
---

This lamp checks train times once a minute and changes colour when it's time to leave. I've allowed **at least two minutes on the platform**; if you can't make that, it looks for the next train.

![A small lamp glowing pale green on a hallway shelf beside a key](/blog/apple-home-when-to-leave-light/lamp.webp)

## How the colours work

The example uses Sevenoaks to Blackfriars: seven minutes walking normally, five walking quickly. Adjust both for your route.

| Colour | What to do |
|---|---|
| **Amber** | Wait a little. Brighter means more time to spare. |
| **Green** | Leave at your normal pace. Full brightness means go now. |
| **Purple** | Leave now and walk quickly, keeping the two-minute platform wait. |
| **Red** | Check your journey app: a delay of at least ten minutes, or no reachable train within 90 minutes. |

For an **08:17 train**, it's green from 08:04 to 08:08, then purple until 08:10. After that, even the quick walk won't leave two minutes on the platform, so the next update skips this train.

<details>
<summary>See the timing chart</summary>

![Light colour and brightness as departure approaches, including a purple quick-walk window](/blog/apple-home-when-to-leave-light/leave-curve.svg "Seven minutes walking normally, five quickly, and two on the platform. With no later train, the chart turns red after the cutoff.")

</details>

## Build the train light

You'll need a colour bulb in Apple Home and a Homecast relay that stays awake. Open **Automations** from the dashboard's top-right menu, then **Create → Homecast**. Connect the nodes in the three steps below.

<details id="train-setup">
<summary>1. Set the schedule and journey request</summary>

Add a **Schedule** with **Repeating interval** set to one minute. Connect an **IF** in **Expression** mode:

<!-- snippet: commute-hours -->
```
now().weekday >= 1 and now().weekday <= 5 and now().hour >= 7 and now().hour < 9
```

This runs on weekdays from 7am to 9am, using the relay's clock. Connect an **HTTP Request** to the IF's green (true) output, with **GET** and this URL:

```
https://api.tfl.gov.uk/Journey/JourneyResults/910GSVNOAKS/to/910GBLFR?mode=national-rail
```

To find the IDs for your own stations, search with:

```
https://api.tfl.gov.uk/StopPoint/Search/Sevenoaks?modes=national-rail
```

Put the returned IDs in the journey URL and open it in a browser to check the route.

</details>

<details id="train-code">
<summary>2. Copy the train-light code</summary>

Add a **Code** node after the request. Adjust the constants for your walk and preferred wait. Keep `BUFFER` at least two, `QUICK_WALK` shorter than `WALK`, and `PATIENCE` greater than `BUFFER`.

<!-- snippet: train-light -->
```js
const WALK = 7;      // normal walk: front door to platform, in minutes
const QUICK_WALK = 5; // quick walk you can reliably manage, in minutes
const BUFFER = 2;    // minimum platform wait; never set below 2
const PATIENCE = 6;  // the longest platform wait you don't mind
const LATE = 10;     // this many minutes late means red

if (![WALK, QUICK_WALK, BUFFER, PATIENCE, LATE].every(Number.isFinite)
    || QUICK_WALK <= 0 || QUICK_WALK >= WALK || BUFFER < 2
    || PATIENCE <= BUFFER || LATE < 0) {
  throw new Error('Use 0 < QUICK_WALK < WALK, BUFFER >= 2, PATIENCE > BUFFER and LATE >= 0.');
}

// The journey planner's answer, from the HTTP Request node before this one
const plan = Object.values(input.nodes)
  .map((node) => node.data && node.data.body)
  .find((body) => body && Array.isArray(body.journeys));
const journeys = plan ? plan.journeys : [];

// TfL's times are London time with no zone on them, so read them as London time
const london = (t) => {
  const utc = Date.parse(t + 'Z');
  const zone = new Date(utc).toLocaleString('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' });
  return utc - Number((zone.match(/GMT([+-]\d+)/) || [0, 0])[1]) * 3600000;
};
const now = Date.now();
const minutesUntil = (ms) => (ms - now) / 60000;
const minutesLate = (actual, planned) => (london(actual) - london(planned || actual)) / 60000;

const options = journeys.map((j) => {
  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  return {
    leaves: (first.scheduledDepartureTime || first.departureTime).slice(11, 16),
    arrives: j.arrivalDateTime.slice(11, 16),
    expected: london(first.departureTime),
    late: Math.max(
      minutesLate(first.departureTime, first.scheduledDepartureTime),
      minutesLate(last.arrivalTime, last.scheduledArrivalTime),
    ),
  };
}).sort((a, b) => a.expected - b.expected);

const red = (summary) => ({ colour: 'red', hue: 0, saturation: 100, brightness: 100, summary });
const mix = (from, to, f) => Math.round(from + (to - from) * Math.min(1, Math.max(0, f)));

// Keep the platform buffer even if you need to walk quickly.
const train = options.find((o) => minutesUntil(o.expected) >= QUICK_WALK + BUFFER);
if (!train || minutesUntil(train.expected) > 90) return red('No trains to catch in the next 90 minutes');
if (train.late >= LATE) return red(`The ${train.leaves} is running ${Math.round(train.late)} min late`);

// Minutes you'd spend on the platform if you walked out of the door right now
const spare = minutesUntil(train.expected) - WALK;
const leaveIn = Math.max(0, Math.floor(spare - BUFFER));
const gets = `the ${train.leaves}, in at ${train.arrives}`;

if (spare < BUFFER) {
  return {
    colour: 'purple', hue: 280, saturation: 100, brightness: 100,
    summary: `Walk quickly now for ${gets} — allow ${QUICK_WALK} min walking and at least ${BUFFER} min on the platform`,
  };
}

if (spare <= PATIENCE) {
  // Green only while a normal walk still preserves the minimum platform wait.
  return {
    colour: 'green', hue: 120, saturation: 100,
    brightness: mix(100, 30, (spare - BUFFER) / (PATIENCE - BUFFER)),
    summary: leaveIn === 0 ? `Go now for ${gets}` : `Good time to go — ${gets}`,
  };
}

// Amber, brighter the longer you'd be waiting
return {
  colour: 'amber', hue: 35, saturation: 100,
  brightness: mix(30, 100, (spare - PATIENCE) / 15),
  summary: `Leave in ${leaveIn} min for ${gets}`,
};
```

</details>

<details id="train-lamp">
<summary>3. Connect the lamp and test it</summary>

Add four **Set Device** nodes for the lamp: **Power State** on, then **Hue**, **Saturation** and **Brightness**. For the last three, switch **Fixed** to **Expression** and use the Code node's matching field, such as `{{ nodes['…'].data.hue }}`. Pick the Code node from the data list and replace its final `result` with `hue`, `saturation` or `brightness`.

Save, reopen, then select **Schedule → Run Test**. Check the Code node's `summary` in **Executions** for the chosen journey and leave time.

Add a separate weekday automation to turn the lamp off at 9am. The time condition stops updates but doesn't switch it off.

![The train light in the automation editor with schedule, journey request, Code and Set Device nodes](/blog/apple-home-when-to-leave-light/editor-train-light.webp "The complete train automation, with notes beside each stage.")

</details>

The colour can be almost a minute old. Increase `BUFFER` beyond two minutes to cover that lag and getting out of the door. Check the result against your journey app; this isn't a cancellation alert.

<details>
<summary>Try a simpler version: an umbrella reminder</summary>

Use a separate lamp, or just a notification, so train updates don't overwrite the weather warning.

Set a **Schedule** for 07:30 on weekdays. Add an **HTTP Request**, using **GET** and this [Open-Meteo](https://open-meteo.com) URL. Replace the coordinates with your location:

```
https://api.open-meteo.com/v1/forecast?latitude=51.27&longitude=0.19&hourly=precipitation_probability&forecast_days=1&timezone=auto
```

Add a **Code** node to find the highest rain probability between 8am and 7pm:

<!-- snippet: umbrella -->
```js
const RAINY = 50;  // % chance of rain that's worth an umbrella

// The forecast, from the HTTP Request node before this one
const forecast = Object.values(input.nodes)
  .map((node) => node.data && node.data.body)
  .find((body) => body && body.hourly);

const { time, precipitation_probability: chance } = forecast.hourly;
let worst = { chance: 0, at: '' };
time.forEach((t, i) => {
  const hour = Number(t.slice(11, 13));
  if (hour >= 8 && hour <= 19 && chance[i] > worst.chance) {
    worst = { chance: chance[i], at: t.slice(11, 16) };
  }
});

return { rain: worst.chance >= RAINY, chance: worst.chance, at: worst.at };
```

Add an **IF** in **Expression** mode. Pick the Code node from the data list, then replace the final `result` with `rain`: `nodes['…'].data.rain`.

On its true branch, add **Notify** with `Take an umbrella — {{ nodes['…'].data.chance }}% chance of rain around {{ nodes['…'].data.at }}`. Use your Code node's actual ID.

For a blue lamp too, add **Set Device** nodes for power on, hue 240, saturation 100 and your chosen brightness. Add a reset if you want to clear yesterday's warning on a dry day; the false branch otherwise does nothing.

Save, reopen, then use **Schedule → Run Test** and check **Executions**.

![The umbrella automation in the Homecast editor](/blog/apple-home-when-to-leave-light/editor-umbrella-light.webp "Schedule, forecast, rain check and reminder.")

Phone push notifications need Homecast Cloud. Community Edition shows a banner on the Mac.

</details>

These examples use [TfL](https://api.tfl.gov.uk) and Open-Meteo without API keys; their usage limits still apply. Other APIs may block browser requests from the relay. You can also run the logic elsewhere and control the lamp through the [REST API](https://docs.homecast.cloud/reference/rest).
