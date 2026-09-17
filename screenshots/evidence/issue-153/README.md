# Camera viewer in landscape — the empty band

Evidence for parob/homecast-cloud#153: a phone held sideways put a 212px live
view in the middle of a 944px card.

Committed, unlike the captures in the gitignored `output/`, because a pull
request whose whole substance is "does this look better" has to show the picture
*in the pull request*.

| File | What it shows |
|---|---|
| `before.png` | `origin/main` at 956 × 440 — the image stranded in an empty band |
| `after.png` | The same viewport on this branch — the card sized to the image |
| `after-long-name.png` | A name far too long for the narrowed card: it truncates, the close control stays in its corner, and the width settles rather than hunting |

## Regenerating

All three are the reported geometry: an iPhone 16 Pro Max (440 × 956) turned
sideways, with the inset the pinned tab bar reserves.

    npx playwright test camera-viewer-fit.spec.ts --project=screenshots \
      -g "a phone held sideways"

That test drives the state each picture shows — 956 × 440 with the tab bar's
inset, then the same card with an over-long name. The pictures themselves were
taken by adding a `page.screenshot` to it while iterating, once from this branch
and once from `origin/main`; the spec does not write them on every CI run.

What the spec does assert is the numbers behind them: the image is more than
half the card's width in landscape, the close control stays in its corner
however long the name is, the width settles rather than hunting, and a window
tall enough not to constrain the image still gives the camera the full 960px
card.

## The numbers

Measured at 956 × 440 with a 141px bottom inset, 16:9 image:

| | Card | Image | Image ÷ card |
|---|---|---|---|
| Before | 944 × 281 | 212 × 119 | 0.22 |
| After | 304 × 261 | 212 × 119 | 0.70 |

The image is the same size in both: with 119px of height to spend, 16:9 buys
212px of width and nothing changes that. What the fix removes is the 732px of
empty card around it.
