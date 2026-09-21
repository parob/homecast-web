# The sized tile that was wide but not tall

Evidence for parob/homecast-cloud#159, a regression in the feature `issue-154/`
argued for: a Large camera claimed its four cells and went on drawing at one
row inside them — "stretched horizontally but not vertically".

The cause is one element. The cell gets `align-self: stretch`, and the card's
height comes down an `h-full` chain — `height: 100%`, which ends at the first
ancestor with `height: auto`. The dashboard has one between the two: the
`relative` div that positions the deal badge and the expanded overlay. The
fixture next door renders the card as the cell's only child, so its chain is a
link shorter than production's and it could not see this.

| File | What it shows |
|---|---|
| `wrapped-large-before.png` | Before — full width, one row tall, the second row left empty |
| `wrapped-large.png` | After — the same tile filling all four cells |

Both are the fixture at `?size=large&wrapped=1`, which is the dashboard's own
wrapper around the real `WidgetCard`. `widget-sizes.spec.ts` measures the same
geometry it photographs, so the pictures and the assertions come from one run.
The "before" was captured against the unfixed code and is committed rather than
regenerated: the spec that produces it now passes.
