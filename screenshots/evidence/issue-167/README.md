# parob/homecast-cloud#167 — the battery reading on an expanded lock was painted dark on a dark tile

> "I can't read the battery font on the screen"

Reported from an iPhone against a dark wallpaper, with a screenshot of an
expanded Aqara lock. Nothing was missing and nothing was too small: the line was
painted `rgb(2, 8, 23)` on a tile filled `rgba(0, 0, 0, .2)`.

## Why only that line

A tile over a dark wallpaper flips to white ink in `WidgetWrapper.tsx`, and that
rule is a list of **element names**:

```
[&_h3]:!text-white [&_p]:!text-white/70 [&_span:not([data-status-badge])]:!text-white/70 … [&_.tile-ink]:!text-white
```

`CircleControl`'s `detail` line renders as a bare `<div>`, so it matched none of
them and kept the card's default dark foreground. The name and the state
directly above it are an `h3` and a `span`, which is exactly why they turned
white and this one did not — and why the tile looks correct apart from one line.

`detail` is passed by `LockWidget` alone, so a battery-powered lock's expanded
panel is the only surface this reaches.

## `battery-ink-before-after.png`

The same fixture, the same wallpaper, the same viewport — the reporter's iPhone
(440×956, DPR 3) — with and without the fix. `lock-before.png` and
`lock-after.png` are the two halves unscaled.

| | colour | element opacity | painted over the tile | contrast |
|---|---|---|---|---|
| **before** | `rgb(2, 8, 23)` | `.7` | `rgb(6, 10, 20)` | **1.03 : 1** |
| **after** | `rgb(255, 255, 255)` | `.7` | `rgb(183, 183, 182)` | **9.55 : 1** |
| the state line above it, unchanged | `rgba(255, 255, 255, .7)` | `1` | `rgb(183, 183, 182)` | 9.55 : 1 |

The last row is the target, not a coincidence: it is the same kind of secondary
line on the same glass, so the fixed line should land on the same painted ink,
and the spec asserts it does.

## The guard

`screenshots/lock-battery-ink.spec.ts`, in the CI config, driving
`fixtures/lock-battery-ink.tsx` — the real `LockWidget`, expanded, with a
battery service, inside a dark-wallpaper `BackgroundContext`.

It asserts the **contrast the reader gets**, composited from the live page's own
colours (text over glass over wallpaper), rather than that a class is present: a
class list can be right while the paint is wrong. On `main` it measures 1.03 and
fails; with the fix, 9.55.
