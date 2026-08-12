import React from 'react';
import type { IconStyle } from './iconColors';
import { useBackgroundContext } from '@/contexts/BackgroundContext';

// A wallpaper's darkness isn't known until its image decodes, so a widget first
// paints with the light recipe and then recolours. These transitions run at the
// same 300ms as BackgroundImage's fade-in so the widget settles *with* the
// wallpaper instead of snapping ahead of it. Declared unconditionally on
// purpose: a transition applied in the same commit as the value it should
// animate doesn't animate.
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
  /** Colourful mode accent color class (e.g., 'bg-yellow-300/50') */
  accentColorClass?: string;
  /** Pressed — the whole tile shrinks, glass included. */
  pressed?: boolean;
}

export const WidgetWrapper: React.FC<WidgetWrapperProps> = ({
  children,
  className = '',
  isOn = false,
  iconStyle = 'standard',
  accentColorClass,
  pressed = false,
}) => {
  const { isDarkBackground } = useBackgroundContext();

  // When OFF on dark background, adjust text and UI elements
  const darkModeClass = !isOn && isDarkBackground
    ? '[&_h3]:!text-white [&_p]:!text-white/70 [&_span:not([data-status-badge])]:!text-white/70 [&_[data-state=unchecked]]:!bg-white/20 [&_[data-state=unchecked]>span]:!bg-white/70'
    : '';

  // Color layer: primary blue for standard, accent color for colourful
  // Off state: pale grey on light background, dark overlay on dark background
  const colorClass = !isOn
    ? (isDarkBackground ? 'bg-black/20' : 'bg-slate-100/80')
    : (iconStyle === 'colourful' && accentColorClass)
      ? accentColorClass
      : 'bg-blue-200/75';

  // Inset hairline in the off state. On a dark background the ring stays in
  // place and only its colour goes transparent — dropping the class outright
  // would take the box-shadow to `none`, and an inset shadow can't interpolate
  // to that, so it would snap while everything around it fades.
  const borderClass = !isOn
    ? `ring-1 ring-inset ${isDarkBackground ? 'ring-transparent' : 'ring-slate-200'}`
    : '';

  // The press shrinks the glass and the content as two separate transforms
  // rather than one on the wrapper. The wrapper is an ancestor of the
  // backdrop-blur layer, and an animated transform on an ancestor of a
  // backdrop-filter element makes it a new backdrop root — the glass switches
  // off for as long as it runs. On the layer itself a transform is harmless.
  //
  // Scaling only the content, which is what happened before, left the rounded
  // background sitting still while everything inside it moved.
  const pressClass = `transition-transform duration-fast ease-standard ${pressed ? 'scale-[0.97]' : ''}`;

  return (
    <div className={`relative rounded-2xl h-fit ${NO_SELECT} ${RECOLOR_TRANSITION} ${borderClass} ${darkModeClass} ${className}`} style={{ contain: 'layout style paint' }}>
      {/* Blur layer - separate from content so it doesn't break during height animation */}
      <div className={`absolute inset-0 rounded-2xl backdrop-blur-xl shadow-sm transition-colors duration-300 ${colorClass} transform-gpu ${pressClass}`} />
      {/* Content */}
      <div className={`relative z-[1] transform-gpu ${pressClass}`}>
        {children}
      </div>
    </div>
  );
};
