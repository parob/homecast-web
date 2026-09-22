# parob/homecast-cloud#173 — Pin leaves the expanded panel

> "Remove pin from the options when you expand any widget - this should
> Only be accessible in editing mode and that's enough"

A request, not a defect: the panel was doing exactly what #197 built it to do.
It is the same argument as the **Size** button one issue earlier
(`../issue-162/README.md`), on the same row of pills, from the same reporter —
the panel was a second route to a setting that Edit Layout's badge already
carries.

## Why this closes no door

Pinning is a **phone** affordance. `Dashboard.tsx` builds the pin context with
`enabled: isPhone`, and `usePinAction` answers `null` when it is off — so the
desktop context menu's `PinTabMenuItem` never actually renders on a desktop,
and the panel was not the second route there, it was the only visible one *on a
phone* besides the badge.

What a phone still has, after this:

| act | route |
|---|---|
| Pin / Unpin an accessory or a service group | Edit Layout's badge on the tile — `EditActions.pinButton`, beside Hide |
| Pin / Unpin a room or a collection | the same badge on a sidebar row — `RowEditActions` |
| Unpin | the tab bar's own ⊗ badge, in tab edit mode — `MobileTabBar` |

And it brings accessory and group tiles into line with the rest of the
dashboard: scene and shortcut cards have pinned from the badge alone since touch
lost its context menus — `ShortcutCards.test.tsx`, *"offers Pin on the tile
while editing, which is where touch pins from now"*.

## Measured

The fixture is the real `WidgetCard` (`../../fixtures/expanded-actions.tsx`), at
the 440px the report came from. Cluster width is the pills plus their 6px gaps.

| case | before | after |
|---|---|---|
| ordinary accessory (the reported doorbell / lock) | Analytics · Share · **Pin** — 229px | Analytics · Share — **166px** |
| widest — a virtual accessory | Analytics · Edit · Share · **Pin** · Delete — 377px | Analytics · Edit · Share · Delete — **314px** |

That second row answers the question asked on review of #210 — *"in the example
it wraps to two lines is this defo necessary?"* At 440px the panel's content box
is ~368px, so the widest cluster used to wrap and **now fits on one line**. It
still wraps at 320px, where the box is ~248px, and there is a test for each.

## Files

| file | what it is |
|---|---|
| `panel-before-after.png` | both cases, before and after, side by side |
| `ordinary-before.png` / `ordinary-after.png` | the reported case, 440px |
| `widest-before.png` / `widest-after.png` | the virtual accessory, 440px |
| `panel-after.png` | written by `expanded-actions.spec.ts` on every run |

## Guards

- `screenshots/expanded-actions.spec.ts` — "the panel offers no Pin button even
  though pinning is on offer", plus the wrap arithmetic above. In
  `playwright.ci.config.ts`, so it runs on every commit.
- `src/components/widgets/__tests__/edit-mode-tile.test.tsx` — the same claim in
  jsdom, asserted in both directions: no Pin in the panel, Pin still on the
  badge. Red before this change with `expected <button …> to be null`.
- Untouched and still green: `edit-badge-hit-target.spec.ts`,
  `tab-bar-unpin-badge.spec.ts`.
