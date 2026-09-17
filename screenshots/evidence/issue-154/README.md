# Expandable camera tile — the three sizes

Mock for parob/homecast-cloud#154, which asks for a camera widget that can take
up four grid cells, or two stacked vertically when the camera's resolution suits
it. **Nothing here is implemented.** The proposal and the open questions live on
the issue; this is the picture that goes with it.

Committed for the same reason as `issue-118/`: the substance of the decision is
"does this look right", and only images served from a GitHub host embed.

| File | What it shows |
|---|---|
| `sizes.png` | Regular (1×1, what ships today), Large (2×2) and Tall (1×2), side by side in a two-column phone grid |

The tiles are the real `WidgetCard` and `CameraTilePreview`. The camera image is
**drawn on a canvas in the fixture** — no private camera photograph — so only the
aspect ratios and the cropping are real. Landscape is 1280×720, portrait 960×1280.

## What making the mock turned up

Two things that are the reason the feature is not one CSS property, both worth
keeping even if this is never built:

- **The tile root is `h-fit`.** A tile will not stretch into a taller grid area,
  so a spanning wrapper leaves the card its original height.
- **The preview is `absolute inset-0` inside the card *header*, not the card.**
  So even a stretched card leaves the picture the size it was. Making a tile
  bigger and making its picture bigger are separate changes.

The fixture sidesteps both by growing the header by exactly the extra grid area
(`extraHeight = (rows - 1) * (rowHeight + gap)`) and letting the card size to its
content, which is what the real change would have to arrange for. The row height
is measured from a real compact tile rather than chosen.

Known mock artefact: the "5m ago" caption is `self-center`, so on a tall tile it
floats to the middle rather than sitting top-right. In a real implementation it
would be `self-start`.

## Regenerating

    cd screenshots
    npx vite --host 127.0.0.1 --port 8080      # from the repo root, in another shell
    npx playwright test --config=playwright.mock.config.ts

`playwright.mock.config.ts` exists because the mock is not a test and must stay
out of `playwright.config.ts`'s `testMatch` — that list is the suite CI runs.
