import React from 'react';
import type { IconStyle } from './iconColors';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { resolveWidgetTint, STANDARD_TINT } from '@/lib/widget-tint';

// A wallpaper's darkness isn't known until its image decodes, so a widget first
// paints with the light recipe and then recolours. These transitions run at the
// same 300ms as BackgroundImage's fade-in so the widget settles *with* the
// wallpaper instead of snapping ahead of it. Declared unconditionally on
// purpose: a transition applied in the same commit as the value it should
// animate doesn't animate.
//
// This also carries the tint ramp: the fill is an inline background-color now,
// and transition-colors animates an inline value exactly as it did a class.
//
// Spans are deliberately left out — the Switch thumb carries transition-transform
// and a descendant transition-colors rule would outrank it and break its slide.
const RECOLOR_TRANSITION =
  'transition-shadow duration-300 [&_h3]:transition-colors [&_h3]:duration-300 [&_p]:transition-colors [&_p]:duration-300';

// A widget is a control surface, not a document. Dragging a brightness bar,
// long-pressing a tile for its context menu, or double-tapping to expand one
// all left a blue selection across the title and readout. Declared here rather
// than per widget so it covers every type in every mode at once — compact tile,
// inline card, and the expanded overlay panel all render through this wrapper.
//
// Form fields opt back in: Firefox propagates `none` into inputs, which would
// make a virtual accessory's text and number values impossible to select while
// editing. WebKit exempts them already, so this only matters off-Apple.
const NO_SELECT =
  'select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text';

interface WidgetWrapperProps {
  children: React.ReactNode;
  className?: string;
  /** Whether the widget is in ON/active state */
  isOn?: boolean;
  /** Icon style mode */
  iconStyle?: IconStyle;
  /** The service type's fill colour, as a hex (see iconColors' `tint`). */
  tint?: string;
  /** Overrides the shared full-strength alpha, for the timer's paler green. */
  tintAlpha?: number;
  /**
   * How far on the accessory is, 0-1 — a light's brightness, a blind's
   * openness, a fan's speed. `null`/undefined means it has no such notion (a
   * lock, a switch, a bulb that cannot dim) and paints at full strength.
   */
  intensity?: number | null;
  /** Pressed — the whole tile shrinks, glass included. */
  pressed?: boolean;
  /**
   * This tile is one of the hidden ones Edit Layout revealed, so it has to
   * leave when the reveal ends rather than blink out.
   *
   * Marks the glass and the content — the same two layers `pressClass` moves,
   * and for the same reason. The wrapper is an ancestor of the backdrop-blur
   * layer, so an animated opacity out here would make it a new backdrop root
   * and switch the glass off for the length of the exit.
   *
   * It also cannot go any deeper. The Card inside is `!bg-transparent`: every
   * pixel of the tile you actually see is painted by the blur layer, which is
   * the Card's SIBLING. Marking the Card faded the title and the icon and left
   * a solid coloured rectangle sitting there until React took it away, which is
   * the blink this exists to remove, wearing a fade.
   */
  hiddenItem?: boolean;
}

export const WidgetWrapper: React.FC<WidgetWrapperProps> = ({
  children,
  className = '',
  isOn = false,
  iconStyle = 'standard',
  tint,
  tintAlpha,
  intensity,
  pressed = false,
  hiddenItem = false,
}) => {
  const { isDarkBackground, effectiveLuminance } = useBackgroundContext();

  // The fill, the ink and the hairline all come from one decision so they
  // cannot disagree. 'standard' paints every type the same blue; 'colourful'
  // uses the service type's own colour. See lib/widget-tint.ts.
  const { backgroundColor, tone, ringColor } = resolveWidgetTint({
    tint: iconStyle === 'colourful' ? tint : STANDARD_TINT,
    intensity,
    isOn,
    isDarkWallpaper: isDarkBackground,
    wallpaperLuminance: effectiveLuminance,
    alpha: iconStyle === 'colourful' ? tintAlpha : undefined,
  });

  // Ink. This used to be `!isOn && isDarkBackground` — "an ON tile is a pale
  // accent and takes dark ink". That stopped being true once the fill became
  // proportional: a light at 15% over a dark wallpaper is a wash over black
  // and needs white ink even though it is on. So it follows the fill instead.
  //
  // `.tile-ink` / `.tile-ink-track` are hooks for content that sets its own
  // colour and cannot inherit — the hero sliders. They are matched from here
  // rather than resolved by the widget itself on purpose: a widget calling
  // useTileTone would subscribe to BackgroundContext, and a context read
  // bypasses React.memo, so every light tile re-rendered on every Dashboard
  // render. That is a slider drag's whole frame budget.
  const darkModeClass = tone === 'light'
    ? '[&_h3]:!text-white [&_p]:!text-white/70 [&_span:not([data-status-badge])]:!text-white/70 [&_[data-state=unchecked]]:!bg-white/20 [&_[data-state=unchecked]>span]:!bg-white/70 [&_.tile-ink]:!text-white [&_.tile-ink-track]:!bg-white/15'
    : '';

  // Inset hairline, fading out as the fill comes up rather than disappearing at
  // the on/off boundary. The ring stays in place and only its colour changes —
  // dropping the class outright would take the box-shadow to `none`, and an
  // inset shadow can't interpolate to that, so it would snap while everything
  // around it fades.
  const borderClass = 'ring-1 ring-inset';

  // The press shrinks the glass and the content as two separate transforms
  // rather than one on the wrapper. The wrapper is an ancestor of the
  // backdrop-blur layer, and an animated transform on an ancestor of a
  // backdrop-filter element makes it a new backdrop root — the glass switches
  // off for as long as it runs. On the layer itself a transform is harmless.
  //
  // Scaling only the content, which is what happened before, left the rounded
  // background sitting still while everything inside it moved.
  const pressClass = `transition-transform duration-fast ease-standard ${pressed ? 'scale-[0.97]' : ''}`;

  /** See `hiddenItem`. Both layers, never the wrapper. */
  const leavingMark = hiddenItem ? { 'data-hidden-item': 'true' } : {};

  return (
    <div
      className={`relative rounded-2xl h-fit ${NO_SELECT} ${RECOLOR_TRANSITION} ${borderClass} ${darkModeClass} ${className}`}
      style={{ contain: 'layout style paint', ['--tw-ring-color' as string]: ringColor }}
    >
      {/* Blur layer - separate from content so it doesn't break during height animation */}
      <div
        className={`absolute inset-0 rounded-2xl backdrop-blur-xl shadow-sm transition-colors duration-300 transform-gpu ${pressClass}`}
        style={{ backgroundColor }}
        {...leavingMark}
      />
      {/* Content */}
      <div className={`relative z-[1] transform-gpu ${pressClass}`} {...leavingMark}>
        {children}
      </div>
    </div>
  );
};
