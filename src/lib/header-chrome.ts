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
 * ── The ink matches the page, and the halo carries the contrast ─────────────
 *
 * The glyphs take the **same colour as the home title beside them** — the
 * `isDarkBackground` verdict every other piece of chrome over the wallpaper
 * already follows. A row where "My Home" is white and the ⋮ above it is black
 * reads as a bug even when each half is individually the higher-contrast
 * choice, which is what parob/homecast-web#106 found by trying it.
 *
 * That verdict is a *mood* threshold, though — `isDarkLuminance` calls anything
 * under an effective luminance of 0.8 dark — so matching it means the ink is
 * sometimes the lower-contrast choice: white on the countryside wallpaper's
 * header band, which measures 0.67, is about 1.5:1. Filled discs used to hide
 * that. Bare glyphs cannot, so the **halo** takes the job instead, and is
 * reinforced exactly when the ink loses: see `headerHaloNeedsReinforcing`.
 *
 * A title is a solid block of 28px strokes and survives this; a 2px icon stroke
 * does not, which is why the reinforcement lives here and not on the title.
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
 * Deliberately NOT used to pick the ink — the ink matches the title, per the
 * note above. It is used to detect when that choice costs contrast.
 */
export const INK_CONTRAST_CROSSOVER = 0.179;

/**
 * Would white ink out-contrast black over this background?
 *
 * Takes the *effective* luminance (brightness adjustment already applied) of
 * the band the header sits over — see `analyzeLoadedImageBand`, since the strip
 * under the controls is routinely nothing like the image's average.
 */
export function whiteInkWins(bandLuminance: number | null | undefined): boolean {
  if (bandLuminance == null) return false;
  return bandLuminance < INK_CONTRAST_CROSSOVER;
}

/**
 * Does the halo need to work harder than usual?
 *
 * True when the ink we are committed to — the page's, so the row stays of a
 * piece — is the one that loses on contrast against the strip behind it. That
 * is the countryside case: a white title and white icons over a bright sky,
 * correct as a set and individually weak.
 *
 * `null` means nothing has been measured (no wallpaper, or an image whose
 * pixels have not been read yet). No reinforcement then: there is no evidence
 * of a problem, and a permanently heavy halo is a worse default than a light
 * one.
 */
export function headerHaloNeedsReinforcing(
  inkIsLight: boolean,
  bandLuminance: number | null | undefined,
): boolean {
  if (bandLuminance == null) return false;
  return inkIsLight !== whiteInkWins(bandLuminance);
}

/**
 * The halo, as a Tailwind arbitrary `filter`.
 *
 * Two layers, never one: a tight core lifts the stroke off whatever is
 * immediately behind it, and a wider soft one separates it from a busy photo.
 * A single tight shadow disappears into mid-tone clutter; a single wide one
 * reads as a smudge.
 *
 * Reinforced adds a third layer and raises the opacities. It is deliberately
 * still a halo and not a plate — the point of the change was to stop drawing
 * shapes behind the icons.
 *
 * ── Why these are four spelled-out constants and not one template ───────────
 *
 * **Tailwind only emits CSS for class names it can read verbatim in the
 * source.** It scans text; it does not evaluate. Writing this as
 * `` `…rgba(${c},0.9)…` `` compiles, type-checks, passes every unit test and
 * ships *nothing*: the build emits a rule for the literal candidate
 * `.[filter:drop-shadow(0_1px_1px_rgba($\{c\}…` and the class the component
 * actually puts on the element matches no rule at all. The icons then have no
 * halo, silently, in dev and in production alike — which is exactly what
 * happened between parob/homecast-web#106's last push and its merge.
 *
 * So: no interpolation, no concatenation, no building a class from parts.
 * `__tests__/header-chrome.test.ts` asserts that every string these functions
 * can return appears verbatim in this file, which is the same rule Tailwind's
 * scanner applies.
 */
const HALO_LIGHT_INK =
  '[filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.65))_drop-shadow(0_0_7px_rgba(0,0,0,0.4))]';
const HALO_LIGHT_INK_STRONG =
  '[filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.9))_drop-shadow(0_0_4px_rgba(0,0,0,0.75))_drop-shadow(0_0_10px_rgba(0,0,0,0.55))]';
const HALO_DARK_INK =
  '[filter:drop-shadow(0_1px_2px_rgba(255,255,255,0.8))_drop-shadow(0_0_7px_rgba(255,255,255,0.55))]';
const HALO_DARK_INK_STRONG =
  '[filter:drop-shadow(0_1px_1px_rgba(255,255,255,0.95))_drop-shadow(0_0_4px_rgba(255,255,255,0.85))_drop-shadow(0_0_10px_rgba(255,255,255,0.7))]';

function halo(inkIsLight: boolean, reinforce: boolean): string {
  if (inkIsLight) return reinforce ? HALO_LIGHT_INK_STRONG : HALO_LIGHT_INK;
  return reinforce ? HALO_DARK_INK_STRONG : HALO_DARK_INK;
}

/**
 * Classes for an icon control in the header.
 *
 * `!` on the background because these sit on shadcn `Button variant="ghost"`,
 * whose own hover colour would otherwise win.
 */
export function headerControlClass(inkIsLight: boolean, reinforce = false): string {
  const ink = inkIsLight
    ? 'text-white !bg-transparent hover:!bg-white/15 active:!bg-white/20'
    : 'text-foreground !bg-transparent hover:!bg-black/10 active:!bg-black/15';
  return `${ink} ${halo(inkIsLight, reinforce)}`;
}

/**
 * The same, for a control that is not a `Button` — the status dot is a bare
 * `<button>`, so it needs no `!` to beat a variant it does not have.
 */
export function headerDotClass(inkIsLight: boolean, reinforce = false): string {
  const ink = inkIsLight
    ? 'text-white bg-transparent hover:bg-white/15'
    : 'text-foreground bg-transparent hover:bg-black/10';
  return `${ink} ${halo(inkIsLight, reinforce)}`;
}
