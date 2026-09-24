# parob/homecast-cloud#199 — "The menus in the web mobile view don't look the same as the menus in the native app"

> Filed 2026-09-23 17:27 UTC. A request, not a defect — nothing here was broken,
> the header's overflow menu (⋯) and the home switcher are a plain opaque
> shadcn/ui dropdown next to the native app's translucent `UIMenu`.

A first pass on this issue proposed a scoped CSS change and asked whether it
matched what was wanted before touching code. The reporter confirmed on
2026-09-24 00:40 UTC ("We want the web view controls to reflect one more
accurately looked like the native controls as close as we can get them"),
so this is that change, built.

## One correction to the earlier analysis

That first pass also claimed the overflow trigger used a vertical `⋮`
(`MoreVertical`) against native's horizontal `⋯`. Reading the actual call site
(`Dashboard.tsx`'s `headerRightMenu`) shows it already renders `MoreHorizontal`
— the horizontal ellipsis was already correct in both `before.png` and
`after.png` below. No icon change was needed; this README says so rather than
claiming credit for a fix that was never necessary.

## What changed

1. **Real translucency.** `DropdownMenuContent`'s `scrim` variant — the flag
   already used by exactly these two "card" menus, as opposed to an incidental
   dropdown like a sort order — now paints `bg-popover/80 backdrop-blur-xl
   backdrop-saturate-150` instead of the opaque `bg-popover`. Same recipe
   `headerGlassClass` already uses for the header's own glass plates, so the
   menu reads as the same material as the chrome it grew out of.
2. **One card instead of two stacked panels.** The overflow menu's titled
   section (home/room/collection name + refresh) sat in its own
   `bg-muted/50 rounded-lg` box with a visible gap before the next group. It is
   now a header row inside the same card, set off by a `DropdownMenuSeparator`
   like every other group — which is what a native `UIMenu` section looks like.

## `overflow-menu-{before,after}.png` / `home-switcher-{before,after}.png`

Captured with `screenshots/issue-199-menu-parity.spec.ts` on the `iphone-screenshots`
project — `overflow-menu-before.png` is the literal stashed source (`git stash`
on this branch, not a simulation), `overflow-menu-after.png` the same page with
the fix applied, same fixture data, same viewport.

The overflow menu is the clearer pair: `before` shows the grey "My Home" panel
with rounded corners top and bottom, a visible seam, then a second white panel
for Edit Layout/Settings, then a hairline rule before Sign Out — two panels
glued together, opaque throughout. `after` is one translucent card (the scene
tiles behind it are faintly visible through the blur) with a single hairline
rule between each logical group.

The home switcher's structure did not need to change — it was already a flat
list with `DropdownMenuLabel`/`DropdownMenuSeparator` — so its before/after
differs only in the material: opaque white in `before`, translucent glass in
`after`.
