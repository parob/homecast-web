# parob/homecast-web#225 — a wallpaper that is slow, not broken

> Filed 2026-09-22 07:36 UTC, from a sweep working parob/homecast-cloud#183.

`BackgroundImage` started a 2-second deadline when an image-backed wallpaper
changed, and that deadline ran the **crossfade** as well as reporting readiness.
`setNewBgReady(true)` takes the outgoing layer to `opacity: 0` and the incoming
one to `opacity: 1` — but the incoming layer's `<img>` wrapper is still
`opacity-0`, because `ImageBackground` only lifts it on its own `onLoad`. So
what the deadline revealed was nothing at all, and 500ms later the outgoing
layer was unmounted outright.

A wallpaper that genuinely *fails* never needed this: `onError` sets `hasError`
and the `(!imageUrl || hasError)` effect completes the transition. The deadline
therefore only ever fired for an image that was **slow**, and the right answer
for a slow image is to keep the one already on screen.

## `before-after.png`

Captured with `screenshots/background-slow-swap.spec.ts`, run once from each
checkout (`SLOW_SWAP_LABEL=before|after`). It drives `/bgdemo`, which mounts the
real `BackgroundImage`, the real `useBackgroundDarkness` and the real
`WidgetWrapper` — not a mock of the layer stack. "⇄ switch room" changes the
wallpaper on the **already-mounted** component, which is the crossfade path the
bug lives on; a replay would remount it and take the cold-start path instead.

440×956 at dsf 2. The incoming image is held 6 s by a route interception, so the
2 s deadline is genuinely outrun rather than raced. Frames are timed from the
switch.

| | 0.5 s | 1.0 s | 2.2 s | 3.5 s | 6.4 s |
|---|---|---|---|---|---|
| **before** | wallpaper | wallpaper | dropping | **bare `bg-background`** | new wallpaper |
| **after** | wallpaper | wallpaper | wallpaper held | wallpaper held | new wallpaper |

`before-3500ms.png` and `after-3500ms.png` are that column on its own.

## Two things the pictures show that the issue did not predict

**The measurement goes with it.** The `bgdemo` status line reads `lum=—` in the
before column and `lum=0.175` in the after one. The deadline reported the
*incoming* image's pending nulls, so `useBackgroundDarkness` was told "nothing
measured" about a wallpaper that was still very much on screen. The fix leaves
the outgoing wallpaper's figures standing, because they describe what is painted.

**That is not cosmetic.** With `lum=—` the widgets keep `isDark=true` — the dark
recipe, white text on `bg-black/20` glass — over a backdrop that has gone white.
In the before column at 2.2 s and 3.5 s the tile labels are grey on white and
barely legible. Holding the wallpaper holds the recipe that matches it.

**Readiness still fires on time.** `2003ms onReady (background visible)` appears
in *both* rows. Whatever is blocked on `onReady` is unblocked at the deadline
exactly as before; only the crossfade and the measurements wait for the image.
