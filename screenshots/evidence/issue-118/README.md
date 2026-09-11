# Header control chrome — before / after

Evidence for parob/homecast-cloud#118 and parob/homecast-web#106: the header
controls with and without their circles (dark background) and slab (light).

These are committed, unlike the captures in the gitignored `output/`, because a
pull request whose whole substance is "does this look better" has to show the
picture *in the pull request*, and only images served from a GitHub host embed.
Regenerate with:

    HEADER_CHROME_LABEL=before npx playwright test header-control-chrome.spec.ts --project=iphone-screenshots   # on main
    HEADER_CHROME_LABEL=after  npx playwright test header-control-chrome.spec.ts --project=iphone-screenshots   # on the branch

which writes the halves to `output/header-chrome/`; the pairs here were
composed from them.
