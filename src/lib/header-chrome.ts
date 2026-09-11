/**
 * What the header's controls are drawn on — burger, search, ⋮ and the status dot.
 *
 * They used to carry a permanent fill: over a dark background each one painted
 * its own `bg-black/40` circle, and over a light one the buttons went
 * transparent while the whole cluster sat on a `material-regular` slab in
 * `AppHeader`. Four filled circles over a photo (parob/homecast-cloud#118) read
 * as four objects sitting on the wallpaper rather than as controls belonging to
 * the app, and the light-background slab is the same idea drawn as one box.
 *
 * The chrome is gone. What replaced it is not "nothing" — an icon has to stay
 * legible over an arbitrary photo, and a fill was doing that job as well as
 * decorating. The glyph now carries its own contrast with a drop shadow keyed
 * to the background it is over: a dark halo under a white glyph, a light one
 * under a dark glyph. That follows the alpha of the rendered icon, so it hugs
 * the strokes instead of drawing a shape around them.
 *
 * Press feedback stays, and is now the only time a disc appears — which is what
 * makes it read as feedback.
 *
 * One module because the controls live in three files (`Dashboard`,
 * `MainLayout`, `StatusBadge`) and looked identical only by five copies of the
 * same string agreeing. Reverting the experiment is reverting this file.
 */

/**
 * Classes for an icon control in the header.
 *
 * `!` on the background because these sit on shadcn `Button variant="ghost"`,
 * whose own hover colour would otherwise win.
 */
export function headerControlClass(isDarkBackground?: boolean): string {
  return isDarkBackground
    ? 'text-white !bg-transparent hover:!bg-white/15 active:!bg-white/20 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]'
    : 'text-foreground !bg-transparent hover:!bg-black/10 active:!bg-black/15 drop-shadow-[0_1px_3px_rgba(255,255,255,0.85)]';
}

/**
 * The same, for a control that is not a `Button` — the status dot is a bare
 * `<button>`, so it needs no `!` to beat a variant it does not have.
 */
export function headerDotClass(isDarkBackground?: boolean): string {
  return isDarkBackground
    ? 'text-white bg-transparent hover:bg-white/15 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]'
    : 'text-foreground bg-transparent hover:bg-black/10 drop-shadow-[0_1px_3px_rgba(255,255,255,0.85)]';
}
