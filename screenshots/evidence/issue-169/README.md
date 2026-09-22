# parob/homecast-cloud#169 — the fix for a reported issue, seen from the app

> "… a little button that you can click that will lead to a specific resolution
> page that's within Homecast itself. This resolution page should have purely
> evidence of the resolution so that will be the screenshots with a very short
> amount text showing you the fix …"

Slice 1 of that request: the **Fix** button on a Reported row, and the view it
opens. Read-only — no merge, no comment, no credential; every action is "open it
where it lives".

## `row-before-after.png`

The Previous tab on a phone (428×926 @2×), same two rows, same mocks. Left is
`main`: a row is a link to GitHub and nothing else. Right is this branch: the
row with a pull request open for it (`claude-pr-open`) carries **Fix** in the
same slot the compose tab's **Add** uses; the row nobody has touched does not.

## `resolution-view.png`

What **Fix** opens for #167: the before/after picture first and full width, its
caption, the one line the routine wrote when it opened the PR, the pull request
by name with the surface it reaches, and — smaller, last — the screenshot that
was reported.

## How they were made

`screenshots/resolution-view.spec.ts` drives the real sheet with the list and
one resolution served from route mocks in the exact shape the server answers
(`GET /rest/issue-report/167/resolution` on homecast-cloud). The two images the
mock refers to are in `mock/` and are served from disk, so the capture does not
depend on the network. `BEFORE=1` against the stashed source produced the left
half of the pair.

The resolution payload itself was checked against production: the parser on
homecast-cloud was run on the real comments of #158, #162 and #167 as the
reporter returns them, and recovered the PR, the summary line and the pictures
on all three — including the `<img>` that the posting path had escaped into a
code span on #158, and the picture posted as a plain link on #162.
