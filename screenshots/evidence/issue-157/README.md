# Three asks from one report

Evidence for parob/homecast-cloud#157. Committed, unlike the captures in the
gitignored `output/`, because two of the three changes are "does this look
better" and that has to show the picture *in the pull request*.

Every capture is the real dashboard driven by Playwright — the phone ones at
440 × 956 with the reporter's own iPhone user agent, the desktop ones at the
window width in the filename.

## 1. The colour Safari's bars take

The page canvas — what iOS 26 Safari tints its status-bar and URL-bar glass
with, and what the wallpaper fades into at both its edges — was sampled from
the wallpaper's top 5%. On a photograph of a building against the sky that
strip is the sky, so a dark facade sat between two bright blue bands.

| File | What it shows |
|---|---|
| `edge-before-bottom.png` | `origin/main` at the end of the page, where the bottom scrim reaches the canvas colour outright — pale blue |
| `edge-after-bottom.png` | The same place on this branch — the same blue family, at the picture's own brightness |
| `edge-before-top.png` | The top scrim on `origin/main` |
| `edge-after-top.png` | The top scrim here |

| | Canvas | Luminance | Wallpaper | Ratio |
|---|---|---|---|---|
| Reporter's screenshot | `#91abd9` | 168.8 | 89.6 | **1.9×** |
| `origin/main`, reproduced | `rgb(167, 188, 226)` | 186.3 | 93.0 | **2.00×** |
| This branch | `rgb(112, 125, 149)` | 124.0 | 93.0 | **1.33×** |

Not 1.0×: `SAMPLED_TINT_LIFT` still nudges the band towards white afterwards so
it does not read as a shadow against the wallpaper it borders.

The wallpaper is `../../fixtures/sky-over-dark-house.png`, built to the
measurements of the reporter's screenshot rather than being their photograph —
see `fixtures/make-sky-over-dark-house.mjs`.

## 2. The way back, on a phone

| File | What it shows |
|---|---|
| `back-crumb-before.png` | `origin/main` — `My Home` above the room title. It went back; it did not say so |
| `back-crumb-after.png` | This branch — `‹ My Home`, the glyph the native iOS build draws in the same corner |

The chevron is inside the button, not beside it, so the thing that looks
tappable is the thing that is. A desktop breadcrumb is unchanged: it reads left
to right as a path and a back arrow in the middle of one points at the wrong
thing. There is a test for each half.

## 3. The navigation panel on a wide screen

It was a flat 248px at every window width.

| File | What it shows |
|---|---|
| `sidebar-before-1920.png` | `origin/main` at 1920 — 248px, both long room names truncated |
| `sidebar-after-1600.png` | This branch at 1600 — 304px, partway across |
| `sidebar-after-1920.png` | This branch at 1920 — 360px, nothing truncated |

| Window | Before | After | Names clipped after |
|---|---|---|---|
| 1280 | 248 | 248 | both |
| 1600 | 248 | 304 | both |
| 1920 | 248 | 360 | none |
| 2560 | 248 | 360 | none |

1280 is deliberately unchanged — below that the grid cannot spare the width.
360 is where it stops, and it is measured rather than chosen: a row spends
about 125px of the panel on the inset, padding, icon and trailing control, and
at 320px a 22-character room name was still seven pixels short of fitting.

## Regenerating

    npx playwright test wallpaper-edge-colour.spec.ts sidebar-width.spec.ts \
      phone-back-crumb.spec.ts --project=screenshots

All four tests fail on `origin/main` — one on the missing chevron, one on the
panel that never widens, one on a canvas 2.00× the wallpaper's luminance. The
fourth (a desktop breadcrumb has no back arrow) passes on both, which is the
point of it. Prefix `EDGE_COLOUR_LABEL=before SIDEBAR_LABEL=before
BACK_CRUMB_LABEL=before` to file the other side.
