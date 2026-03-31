import React, { useRef, useState, useLayoutEffect, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBackgroundContext } from '@/contexts/BackgroundContext';

export interface ExpandedOverlayProps {
  isExpanded: boolean;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}

const OVERLAY_WIDTH = 320;
const PADDING = 10;

// Calculate overlay position and coordinates based on parent element
const getOverlayPositionAndCoords = (element: HTMLElement | null): {
  position: 'left' | 'center' | 'right';
  x: number;
  y: number;
} => {
  if (!element) return { position: 'center', x: 0, y: 0 };

  const rect = element.getBoundingClientRect();

  // Calculate where overlay would be if centered on the widget
  const widgetCenterX = rect.left + rect.width / 2;
  const widgetCenterY = rect.top + rect.height / 2;
  const overlayLeft = widgetCenterX - OVERLAY_WIDTH / 2 - PADDING;
  const overlayRight = widgetCenterX + OVERLAY_WIDTH / 2 + PADDING;

  // Check against viewport edges
  const viewportRight = window.innerWidth;

  let position: 'left' | 'center' | 'right' = 'center';
  let x = widgetCenterX - OVERLAY_WIDTH / 2 - PADDING; // Default: centered

  if (overlayLeft < 0) {
    position = 'left';
    x = rect.left - PADDING;
  } else if (overlayRight > viewportRight) {
    position = 'right';
    x = rect.right - OVERLAY_WIDTH - PADDING;
  }

  return { position, x, y: widgetCenterY };
};

export const ExpandedOverlay: React.FC<ExpandedOverlayProps> = ({ isExpanded, onClose, onMouseEnter, onMouseLeave, children }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<'left' | 'center' | 'right'>('center');
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [contentHeight, setContentHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const { isDarkBackground } = useBackgroundContext();

  // Handle open/close state transitions
  useEffect(() => {
    if (isExpanded) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      // Start closing animation
      setIsClosing(true);
      // Remove from DOM after animation completes
      const timeout = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        setReady(false);
      }, 150); // Match animation duration
      return () => clearTimeout(timeout);
    }
  }, [isExpanded, shouldRender]);

  // Calculate position on mount, before animation
  useLayoutEffect(() => {
    if (isExpanded && shouldRender && parentRef.current) {
      const parent = parentRef.current.parentElement;
      const { position: pos, x, y } = getOverlayPositionAndCoords(parent);
      setPosition(pos);
      setCoords({ x, y });
      // Trigger ready state after position is set and measure content
      requestAnimationFrame(() => {
        if (contentRef.current) {
          setContentHeight(contentRef.current.offsetHeight);
        }
        setReady(true);
      });
    }
  }, [isExpanded, shouldRender]);

  // Handle mouse leave - call immediately
  const handleMouseLeave = useCallback(() => {
    onMouseLeave?.();
  }, [onMouseLeave]);

  const transformOrigin = position === 'left'
    ? 'center left'
    : position === 'right'
      ? 'center right'
      : 'center center';

  // Render a placeholder in the DOM tree to get parent reference
  // The actual overlay is rendered via portal
  return (
    <>
      <div ref={parentRef} className="hidden" />
      {shouldRender && createPortal(
        <div
          className="fixed z-[10060] pointer-events-auto"
          style={{
            left: coords.x,
            // Calculate top to center vertically without using transform
            top: coords.y - (contentHeight ? contentHeight / 2 + PADDING : 100),
          }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="p-[10px]">
            <div
              ref={contentRef}
              className={`relative w-[320px] max-w-[calc(100vw-2rem)] rounded-[20px] overflow-visible cursor-pointer [&_*]:cursor-pointer transition-transform duration-150 ${
                ready && !isClosing
                  ? 'scale-100'
                  : 'scale-90'
              }`}
              style={{ transformOrigin }}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  e.stopPropagation();
                  onClose();
                }
              }}
            >
              {/* Blur background layer - animates independently to avoid breaking children's backdrop-blur */}
              <div className={`absolute inset-0 rounded-[20px] backdrop-blur-xl shadow-xl transition-opacity duration-150 ${
                isDarkBackground ? 'bg-black/20' : 'bg-white/60 shadow-black/10'
              } ${
                ready && !isClosing ? 'opacity-100' : 'opacity-0'
              }`} />
              {/* Content layer - no opacity animation to preserve backdrop-blur */}
              <div className={`relative transition-opacity duration-150 ${
                ready && !isClosing ? 'opacity-100' : 'opacity-0'
              }`}>
                {children}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
