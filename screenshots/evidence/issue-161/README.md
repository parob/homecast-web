# parob/homecast-cloud#161 — the iOS app's top gradient followed the browser's bar work

> "The recent gradient changes for the mobile web app seem to have affected the
> native iOS app top gradient — this shouldn't have affected the native app at all."

They should not have, and the route they took is that `useCanvasTint` computed
**one** colour for two surfaces that want different answers:

| surface | what it is | what it should take |
|---|---|---|
| a phone browser | iOS 26 Safari's glass bars, and the scrims the wallpaper fades into on the way to them | the **whole picture's** brightness — #157, or a bright sky puts two bright bars around a dark facade |
| an app shell | `webView.scrollView.backgroundColor`, seen against the wallpaper's own top rows and nothing else | the wallpaper's **top edge**, as sampled |

## `reported-screen-measured.png`

The attached screenshot, measured row by row. Horizontal standard deviation is
what separates paint from photograph: a picture has texture, a fill does not.

| | |
|---|---|
| the band (y 0–60) | luminance **76.2**, sd **1.0** — flat paint |
| the wallpaper it borders (y 160–260) | luminance **49.4** |
| the wallpaper as a whole | luminance **71.8** |
| band ÷ the edge it touches | **1.54×** |
| band ÷ the whole picture | **1.06×** |

That last ratio is the signature: it is #203's arithmetic (re-expose to the whole
picture, then lift 12% towards white) landing on a surface with no bars.

## `backdrop-before-after.png`

The colour the page hands the WKWebView, recorded through a stubbed
`window.webkit.messageHandlers.homecast` while the real dashboard ran in the
native-iOS-shell configuration, at three commits. It is a picture of the
**colour**, not a screenshot of iOS — there is no iOS in the harness.

| wallpaper | before #194 (`5fde627`) | main (`c27d639`) | with the fix |
|---|---|---|---|
| dusk-over-water | `#231d2e` (32) | `#8f80ae` (135) | `#231d2f` (32) |
| sky-over-dark-house | `#9bb3de` (177) | `#707d95` (124) | `#9bb3de` (177) |
| even-daylight-room | `#b7b0a4` (177) | `#b9b2a9` (179) | `#b7b0a4` (177) |

The browser's `--canvas-tint` is byte-identical before and after the fix on all
three, so #157 is untouched.

## The guard

`screenshots/native-backdrop-colour.spec.ts`, in the CI config. It asserts the
*difference* between the two answers rather than absolute numbers, so retuning
either one does not make it lie. On `main` the two are literally the same value
for every wallpaper — which is the bug, stated as a number.
