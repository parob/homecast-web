# The issue loop — status words, questions, and "Still broken"

> Captured 2026-10-20 by `screenshots/issue-loop-states.spec.ts` at 440×956 @2×.
> Each `*-before.png` is the same spec and payloads run with `BEFORE=1` against
> `main` (`6040e71`).

Until this change the Issues screen turned `claude-attempted` into
**Investigating** and left it there. The routine had in fact finished and asked
a question, and nothing on the screen said so. These pairs show each new state
on the real Open list and the routine's own resolution records for #228, #222,
#227 and the fixed #200.

| File | Shows |
|---|---|
| `issue-loop-list-before.png` / `issue-loop-list.png` | The Open list: every row reads as someone else's progress, then the rows waiting on the reporter first, in their own words |
| `issue-loop-answer-before.png` / `issue-loop-answer.png` / `issue-loop-answer-sent.png` | #228: the question, the reply box, and what a send says when the server started a run |
| `issue-loop-both-before.png` / `issue-loop-both.png` / `issue-loop-both-still-broken.png` | #222: a question and a draft to try, together |
| `issue-loop-try-before.png` / `issue-loop-try.png` | #227: a native draft to try on the phone |
| `issue-loop-fixed-before.png` / `issue-loop-fixed.png` / `issue-loop-fixed-still-broken.png` / `issue-loop-fixed-sent.png` | #200: a fixed report, and saying it came back |
