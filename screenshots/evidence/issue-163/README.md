# parob/homecast-cloud#163 — the home name did not line up with the back button

> "The spacing between the Home name and the back button in the top left doesn't
> lineup between the web Mobile view and the native iOS view — the web Mobile
> view should reflect the native iOS view as closely as possible."

The two screenshots on the issue are the same page, on the same device, at the
same scale: the tile grid lands on the same pixel in both, which is what makes
them comparable at all.

| | native iOS | web mobile | native − web |
|---|---:|---:|---:|
| back button, left edge | 20.9px | 20.9px | 0 |
| "George Street" (the home), left edge | 20.9px | 16.1px | **4.8px** |
| "Front Door" (the room), left edge | 22.1px | 17.3px | **4.8px** |
| tile grid, left edge | 14.9px | 14.9px | 0 |
| tile grid, right gutter | 15.5px | 15.5px | 0 |

Ink-measured off the JPEGs by horizontal gradient, so each figure carries about
±0.6px; the web column is confirmed exactly by the DOM (`20.0` / `15.0`).

## Why

Native draws the bar's back button and the large title from **one** leading
margin — `NativeHeaderBar.swift`:

```swift
let leading = max(view.layoutMargins.left, 16)   // 20pt on a 440pt-wide iPhone
largeEyebrowLabel.frame = CGRect(x: leading, y: 2, width: maxTextWidth, height: eyebrow)
largeTitleLabel.frame   = CGRect(x: leading, y: titleY, width: width, height: titleHeight)
```

The web drew them from **two**:

| thing | lives in | gutter |
|---|---|---|
| the back chevron, the ☰ | the header row (`AppHeader.tsx`, `px-4`) | 20px |
| the home name, the room name | the page's content container (`px-3`) | 15px |

`1rem` is 20px in this app, so `px-4` − `px-3` is 0.25rem = 5px, and that is the
step the reporter could see. It was never specific to room pages: the home view
had the same 5px between the ☰ and the home name.

## The fix, and the thing it deliberately does not do

`headingBarInset` — `pl-1` on the heading when the phone draws its own bar.
`pl-1` **is** the difference between the two gutters, written in the same rem
they are written in, so it stays exact at any Text size rather than being a 5px
constant that happens to be right on one device.

The page's own gutter is **not** widened to close the gap. Native steps the
title in to the bar's margin while the content beneath it keeps the page's 15px
gutter — the last two rows of the table above are the proof, and they match to
the pixel. Widening the container would have moved every tile and broken a
match that is currently exact. `header-title-alignment.spec.ts` asserts the
container stays at 15px for exactly that reason.

## `native-vs-web-before.png`

The two screenshots from the issue, cropped to the header at one scale, with a
red line on the back button's left edge — the same pixel in both. Native's two
names sit on it; the web's start left of it.

## `native-before-after.png`

Native, then the web before, then the web after — each with the line on **its
own** back button's left edge, detected the same way in all three panels
(19.7px, 21.0px, 21.0px; the ~1px spread is edge blur, the DOM says 20.0). The
harness wallpaper is the fixture's, not the reporter's; the alignment is the
subject, not the colour.

## `room-{before,after}.png`, `home-{before,after}.png`

The raw harness captures behind those panels, at the reporter's viewport
(440×956, dsf 3, their exact user agent), halved for size. Both pages, because
both were wrong.

## The guard

`screenshots/header-title-alignment.spec.ts`, in **both** the default and the CI
config. It asserts the *relationship* — the heading's left edge is the header
row's leading margin, whatever that margin is — rather than the number 20, so
retuning either gutter cannot make it lie. On `main` it fails with:

```
  Expected: 20   (the header row's leading margin)
  Received: 15   (the heading's left edge)
```
