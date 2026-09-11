/**
 * What the header's controls are drawn on — burger, search, ⋮ and the status dot.
 *
 * They used to carry a permanent fill: over a dark background each one painted
 * its own `bg-black/40` circle, and over a light one the whole cluster sat on a
 * `material-regular` slab in `AppHeader`. Four filled circles over a photo
 * (parob/homecast-cloud#118) read as four objects sitting on the wallpaper
 * rather than as controls belonging to the app, and the light-background slab
 * is the same idea drawn as one box.
 *
 * The chrome is gone. What replaced it is not "nothing" — an icon has to stay
 * legible over an arbitrary photo, and the fill was doing that job as well as
 * decorating. Two things replace it:
 *
 *  1. The ink colour is chosen by contrast rather than by mood (`headerInkIsLight`).
 *  2. The glyph carries a halo in the opposite colour, which follows the
 *     rendered alpha and so hugs the strokes instead of drawing a shape.
 *
 * Press feedback stays, and is now the only time a disc appears — which is what
 * makes it read as feedback.
 *
 * One module because the controls live in three files (`Dashboard`,
 * `MainLayout`, `StatusBadge`) and looked identical only by five copies of the
 * same string agreeing.
 */

/**
 * Below this luminance a white glyph out-contrasts a black one; above it, the
 * reverse. Not a taste threshold — it is where the two WCAG contrast ratios
 * cross. White on L is 1.05/(L+0.05); black on L is (L+0.05)/0.05; they are
 * equal when (L+0.05)² = 1.05×0.05, i.e. L ≈ 0.179.
 *
 * This is deliberately NOT `isDarkLuminance`'s 0.8. That one asks "does this
 * wallpaper set a dark mood", which is right for tiles and body copy and wildly
 * wrong for bare ink: at 0.8 a background of effective luminance 0.75 still
 * counts as dark and gets white icons, which is a contrast ratio of 1.3:1 —
 * the countryside photo on parob/homecast-web#106, and the one case that did
 * not work.
 */
export const INK_CONTRAST_CROSSOVER = 0.179;

/**
 * Should the header's glyphs be white?
 *
 * Takes the *effective* luminance (brightness adjustment already applied) of
 * the band the header sits over — see `analyzeLoadedImageBand`, since the strip
 * under the controls is routinely nothing like the image's average.
 *
 * `null` means there is no background to measure: no wallpaper, or an image
 * whose pixels have not been read yet. Answering false there hands the glyph
 * `text-foreground`, which is the theme's own ink and correct in both themes —
 * the one answer that cannot be wrong while we do not know.
 */
export function headerInkIsLight(bandLuminance: number | null | undefined): boolean {
  if (bandLuminance == null) return false;
  return bandLuminance < INK_CONTRAST_CROSSOVER;
}

/**
 * Classes for an icon control in the header.
 *
 * `!` on the background because these sit on shadcn `Button variant="ghost"`,
 * whose own hover colour would otherwise win.
 *
 * The halo is two shadows, not one: a tight dark/light core that lifts the
 * stroke off whatever is immediately behind it, and a wider soft one that
 * separates it from a busy photo. A single tight shadow disappears against
 * mid-tone clutter; a single wide one reads as a smudge.
 */
export function headerControlClass(inkIsLight: boolean): string {
  return inkIsLight
    ? 'text-white !bg-transparent hover:!bg-white/15 active:!bg-white/20 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.65))_drop-shadow(0_0_7px_rgba(0,0,0,0.4))]'
    : 'text-foreground !bg-transparent hover:!bg-black/10 active:!bg-black/15 [filter:drop-shadow(0_1px_2px_rgba(255,255,255,0.8))_drop-shadow(0_0_7px_rgba(255,255,255,0.55))]';
}

/**
 * The same, for a control that is not a `Button` — the status dot is a bare
 * `<button>`, so it needs no `!` to beat a variant it does not have.
 */
export function headerDotClass(inkIsLight: boolean): string {
  return inkIsLight
    ? 'text-white bg-transparent hover:bg-white/15 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.65))_drop-shadow(0_0_7px_rgba(0,0,0,0.4))]'
    : 'text-foreground bg-transparent hover:bg-black/10 [filter:drop-shadow(0_1px_2px_rgba(255,255,255,0.8))_drop-shadow(0_0_7px_rgba(255,255,255,0.55))]';
}
