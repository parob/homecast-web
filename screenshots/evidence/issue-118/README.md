# Header control chrome — the options

Evidence for parob/homecast-cloud#118 and parob/homecast-web#106: the header
controls with and without their circles (dark background) and slab (light), and
the three ways of keeping the icons legible once the chrome is gone.

Committed, unlike the captures in the gitignored `output/`, because a pull
request whose whole substance is "does this look better" has to show the picture
*in the pull request*, and only images served from a GitHub host embed.

| File | What it shows |
|---|---|
| `dark.jpg`, `bright.jpg`, `light.jpg` | The original before/after pairs — discs vs. bare icons |
| `sheet-1/2/3.jpg` | The three options as first proposed: discs, ink-by-contrast, scrim |
| `matched-1/2/3.jpg` | Where it landed: discs, ink-by-contrast (rejected), ink matching the title |
| `halo.jpg` | The reinforced halo against the ordinary one, same ink |

Ink-by-contrast was rejected on review: it put a black ⋮ beside a white "My Home"
on the same row, which reads as a bug however well each half contrasts on its
own. The glyphs now take the page's ink and the halo carries the contrast.

## Regenerating

`screenshots/header-control-chrome.spec.ts` takes one half at a time, labelled
by `HEADER_CHROME_LABEL`, writing into the gitignored `output/header-chrome/`:

    HEADER_CHROME_LABEL=discs    npx playwright test header-control-chrome.spec.ts --project=iphone-screenshots   # from origin/main
    HEADER_CHROME_LABEL=contrast npx playwright test header-control-chrome.spec.ts --project=iphone-screenshots   # from this branch

The sheets here were composed from those halves. Option C (the scrim) was
captured from a throwaway patch and is not in the branch.

## The numbers behind the choice

Measured effective luminance of the header band on each preset, at the
brightness the spec uses. `isDarkLuminance`'s 0.8 threshold calls every one of
these "dark" and hands them white icons; `headerInkIsLight`'s 0.179 crossover
is where white actually stops out-contrasting black.

| Background | Whole image | Header band | Band, effective | Ink |
|---|---|---|---|---|
| countryside @78 | 0.185 | 0.250 | 0.670 | dark |
| clouds @85 | 0.471 | 0.404 | 0.821 | dark |
| mountains @60 | 0.206 | 0.365 | 0.492 | dark |
| cliffs @35 | 0.175 | 0.338 | 0.237 | dark |
| beach @30 | 0.358 | 0.094 | 0.057 | white |

Within the band, left and right can disagree sharply — countryside is 0.046 on
the left (trees) against 0.444 on the right (sky), and cliffs is the reverse at
0.526 against 0.129. That is why no single verdict makes every glyph on the row
ideal, and why the halo has to carry the rest.
