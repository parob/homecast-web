import React from 'react';
import type { IconStyle } from './iconColors';
import { useBackgroundContext } from '@/contexts/BackgroundContext';

interface WidgetWrapperProps {
  children: React.ReactNode;
  className?: string;
  /** Whether the widget is in ON/active state */
  isOn?: boolean;
  /** Icon style mode */
  iconStyle?: IconStyle;
  /** Colourful mode accent color class (e.g., 'bg-yellow-300/50') */
  accentColorClass?: string;
}

export const WidgetWrapper: React.FC<WidgetWrapperProps> = ({
  children,
  className = '',
  isOn = false,
  iconStyle = 'standard',
  accentColorClass,
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

  // Inset border for off state on light background only
  const borderClass = !isOn && !isDarkBackground ? 'ring-1 ring-inset ring-slate-200' : '';

  return (
    <div className={`relative rounded-[20px] h-fit ${borderClass} ${darkModeClass} ${className}`} style={{ contain: 'layout style paint' }}>
      {/* Blur layer - separate from content so it doesn't break during height animation */}
      <div className={`absolute inset-0 rounded-[20px] backdrop-blur-xl shadow-sm ${colorClass} transform-gpu`} />
      {/* Content */}
      <div className="relative z-[1] transform-gpu">
        {children}
      </div>
    </div>
  );
};
