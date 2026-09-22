# parob/homecast-cloud#181 — "My issues don't seem to be getting looked at"

> Filed 2026-09-22 00:04 UTC, from `/portal` on an iPhone.

They weren't. Of the six issues filed across the Homecast repos on 21 Sep, four
were never picked up at all, and two of those had the reporter asking on them:
[homecast-cloud#175](https://github.com/parob/homecast-cloud/issues/175) sat for
eight hours carrying "Do this please" and then "Hello?", with no comment, no
label and no pull request on it.

That half is throughput — a shared ceiling of ~15 routine runs a day against six
issues, with `issue_comment` deliberately unwired so a human cannot summon one.
It is routine config and it is not fixed here.

What **is** fixed here is the reason the reporter had to guess. The Previous list
could not tell "nothing has opened this" apart from "someone is working on it":
`fixStatus()` knew two words, `Fixed` and `Fix proposed`, and answered `null` for
everything else.

## `before.png` / `after.png`

The real Open list as `/rest/issue-report` returned it at 00:04Z — same five
rows, same labels. Captured with `screenshots/issue-181-status.spec.ts`.

| row | its labels | before | after |
|---|---|---|---|
| #181 | `bug` `issue-reporter` `app-homecast` `fp-…` | *(blank)* | Not picked up yet |
| #178 | `bug` `issue-reporter` `app-homecast` `fp-…` | *(blank)* | Not picked up yet |
| #175 | `bug` `issue-reporter` `app-homecast` `fp-…` | *(blank)* | Not picked up yet |
| #163 | + `claude-attempted` `claude-pr-open` | Fix proposed | Fix proposed |
| #119 | + `claude-attempted` | *(blank)* | **Investigating** |

The #119 row is the one that makes the point. It had been investigated and
commented on six times, and it rendered exactly like #175, which nothing had
ever opened.

## Two things the after shot is deliberate about

**`Not picked up yet` is muted, not red.** It is the absence of news. An absence
that shouts would make a quiet queue look like a broken one.

**The meta line wraps rather than truncating.** The first pass squeezed the
comment count to `2 com…` to fit the pill. Adding a fact should not cost an
existing one, so the pill takes its own line on a row that is already full —
which is why #178 and #175 are a line taller here and #181 is not.
