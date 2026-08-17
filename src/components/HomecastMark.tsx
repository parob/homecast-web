/**
 * The Homecast mark, inline.
 *
 * The brand tiles in the marketing header and footer used to render a lucide
 * `Home` glyph, which meant they were the one place the logo lived that
 * regenerating the icon files could never reach — the app icon could change and
 * the site header would silently keep the old shape.
 *
 * Geometry is copied from `brand/mark.svg`, which is generated from
 * `brand/params.json`. If the mark changes, re-run `cd brand && npm run build`
 * and paste the three paths and the circle from `brand/mark.svg` in here.
 *
 * Strokes use `currentColor`, so this sits inside the existing gradient tiles
 * exactly the way the lucide icon did — colour comes from the parent.
 */
export function HomecastMark({
  className,
  style,
}: {
  className?: string;
  /** Some callers size the mark inline rather than with a utility class. */
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="127 118 757 757"
      role="img"
      aria-label="Homecast"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={61.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M559.26 190.92 L763.6 340.92 A72 72 0 0 1 793 398.96 L793 708.5 A111 111 0 0 1 682 819.5 L330 819.5 A111 111 0 0 1 219 708.5 L219 404.2 A72 72 0 0 1 248.7 345.94 L462.56 190.67 A82 82 0 0 1 559.26 190.92 Z" />
        <path d="M337.47 576.75 A131.5 131.5 0 0 1 476.28 694.25" />
        <path d="M337.31 463.65 A249 249 0 0 1 594.39 695.13" />
      </g>
      <circle cx={349} cy={691} r={41.5} fill="currentColor" />
    </svg>
  );
}
