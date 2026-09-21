# parob/homecast-cloud#162 — the expanded panel's actions say what they do

> "Remove the expand button from this view. It doesn't need to be here because
> it's now next to the hide and pin button. Also the buttons on the screen are
> just icons it's not clear enough what they'll do. Let's change this so that
> they have labels."

A request, not a defect. Two claims, and they are independent of each other.

## The expand button

The four-squares glyph is `size`, not `expand` — it cycles the tile between
Regular, Large and Tall. It was added to the cluster in #197, which also put the
same cycle on Edit Layout's badge beside **Hide** and **Pin**
(`EditActions.sizeButton`), and the desktop context menu has listed all three
sizes with the current one ticked since the feature landed.

So the panel was the third route to one setting, and dropping it closes no door:

| platform | route that remains |
|---|---|
| touch | Edit Layout badge — the `Maximize2`/`Minimize2` circle next to Hide and Pin |
| desktop | tile right-click → **Size**, all three listed, current one ticked |

That is the rule the Automations grid states in `CLAUDE.md`: whichever route a
platform has must be able to get back, or the setting is a one-way door there.

## The labels

`EditActions` already reached this conclusion for the badge cluster and wrote it
down — *"an eye and a pin needed a legend to explain them, which meant looking
away from the thing you were acting on to find out what you were about to do"*.
The panel's cluster now answers the same way, so the two read alike.

One word on the button, the fuller phrasing as the accessible name:

| reads | accessible name |
|---|---|
| `Analytics` | Analytics |
| `Prices` | Price & Deals |
| `Edit` | Edit Accessory / Edit Virtual Accessory |
| `Share` | Share |
| `Pin` / `Unpin` | Pin to Tab Bar / Unpin from Tab Bar |
| `Delete` | Delete Virtual Accessory |

One word is arithmetic, not taste. Measured in the fixture at the reported
440px viewport, the panel's content box is ~368px and the pills are:

| pill | width |
|---|---|
| Analytics | 88px |
| Share | 72px |
| Delete | 75px |
| Edit | 61px |
| Pin | 57px |

Five of those plus their gaps is 377px — already past the box, which is why the
row wraps. The full phrasings would not have fitted a second row either.

## `panel-before-after.png`

The reported panel, rendered by `fixtures/expanded-actions.tsx` — the real
`WidgetCard`, at 440px, with every action reached through the context that
really gates it. Left: six icon-only circles, Size among them. Right: five
labelled pills, Size gone, `Delete` wrapping to a second row rather than being
cut short.

## `immersive-before-after.png`

The landscape camera, where the cluster shares its line with the accessory's
name and the close control instead of sitting under a hero. Captured at 568px —
the narrowest landscape a phone reports — and with **more** pills than an
immersive camera can actually carry: a camera is never a virtual accessory, so
Edit and Delete are not on offer there and the real maximum is four.

Nothing overflows the card and the title is not clipped; the subtitle takes a
second line, which is the cost.

## The guard

`screenshots/expanded-actions.spec.ts`, in the CI config. Three tests, all three
red on `main` before the change:

| test | what it would catch |
|---|---|
| no Size button *with the three sizes on offer* | the button coming back — asserted on a resizable tile, since an unresizable one proves nothing |
| every action reads as a word, uncut, inside the panel | a pill one character wide; `textContent` alone would pass that |
| a landscape camera keeps its name beside the words | the cluster crushing the title in the immersive top bar |
