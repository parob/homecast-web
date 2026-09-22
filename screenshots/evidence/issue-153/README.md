# Camera viewer in landscape

Evidence for parob/homecast-cloud#153: a phone held sideways put a 212px live
view in the middle of a 944px card.

Committed, unlike the captures in the gitignored `output/`, because a pull
request whose whole substance is "does this look better" has to show the picture
*in the pull request*.

| File | What it shows |
|---|---|
| `before.png` | `origin/main` at 956 × 440 — the image stranded in an empty band |
| `after.png` | The same viewport and route on this branch — the chrome moved onto the image, which now has the whole card |
| `after-tile.png` | The same screen with a camera opened from a dashboard tile rather than the pinned tab bar, so no tab bar inset is reserved: the image is 68% of the screen |

## The numbers

956 × 440, 16:9 image. "Route" is what the camera was opened from, which decides
how much height the overlay reserves at the bottom.

| | Route | Card | Image | Image ÷ card | Image ÷ screen |
|---|---|---|---|---|---|
| `before.png` | tab bar | 944 × 281 | 212 × 119 | 0.22 | 6% |
| `after.png` | tab bar | 464 × 261 | 464 × 261 | 1.00 | 29% |
| `after-tile.png` | dashboard tile | 715 × 402 | 715 × 402 | 1.00 | 68% |

Two separate gains, and they compound:

1. The card no longer asks for a flat 960px when the image cannot fill it, so
   there is no band around the image in any short window.
2. Below `IMMERSIVE_MAX_VIEWPORT_HEIGHT` and wider than tall, the card lays its
   header and action row *on* the image instead of above and below it. That
   chrome was 162 of the 281px the panel had; the image now gets all of it.

## Regenerating

    npx playwright test camera-viewer-fit.spec.ts --project=screenshots \
      -g "a phone held sideways"

That test drives both routes at exactly this geometry and asserts the numbers:
the image fills the card in both directions, it is taller than 240px where it
used to be 119, the name and the close control sit inside the image, the name
does not land on the status line, and the accessory's type disc is not drawn on
top of its own live picture. A sibling test turns the phone upright again and
checks the stacked card comes back.
