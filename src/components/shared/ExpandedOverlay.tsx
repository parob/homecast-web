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
// Offset the overlay content down from the widget's top edge so it visually
// starts just below the top of the compact trigger rather than flush with it.
const TOP_OFFSET = 16;

// Calculate overlay position and coordinates based on parent element.
// The overlay is top-aligned with the trigger so it always opens downward from
// the widget's top edge — never pushed above the viewport regardless of content height.
const getOverlayPositionAndCoords = (element: HTMLElement | null): {
  position: 'left' | 'center' | 'right';
  x: number;
  y: number;
} => {
  if (!element) return { position: 'center', x: 0, y: 0 };

  const rect = element.getBoundingClientRect();

  // Calculate where overlay would be if centered on the widget
  const widgetCenterX = rect.left + rect.width / 2;
  const widgetTopY = rect.top;
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

  return { position, x, y: widgetTopY };
};

export const ExpandedOverlay: React.FC<ExpandedOverlayProps> = ({ isExpanded, onClose, onMouseEnter, onMouseLeave, children }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<'left' | 'center' | 'right'>('center');
  const [coords, setCoords] = useState({ x: 0, y: 0 });
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
      // Trigger ready state after position is set
      requestAnimationFrame(() => {
        setReady(true);
      });
    }
  }, [isExpanded, shouldRender]);

  // Dismiss when tapping outside the overlay, or when scrolling past a
  // threshold. Needed for touch/compact mode where there's no mouse-leave to
  // trigger a collapse. The overlay is position:fixed, so any scroll would
  // otherwise leave it detached from the widget it expanded from.
  useEffect(() => {
    if (!isExpanded) return;

    // The placeholder's parent is the compact trigger widget — taps on it
    // should be handled by the widget's own toggle, not treated as "outside".
    const triggerEl = parentRef.current?.parentElement ?? null;

    const isInsideOverlay = (target: EventTarget | null): boolean => {
      const node = target as Node | null;
      if (!node) return false;
      if (contentRef.current?.contains(node)) return true;
      if (triggerEl?.contains(node)) return true;
      return false;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!isInsideOverlay(e.target)) onClose();
    };

    const SCROLL_THRESHOLD = 40;
    const getScrollY = (t: EventTarget | null): number => {
      if (!t || t === document || t === window) return window.scrollY;
      const el = t as HTMLElement;
      return typeof el.scrollTop === 'number' ? el.scrollTop : window.scrollY;
    };
    let startTarget: EventTarget | null = null;
    let startY = 0;
    const handleScroll = (e: Event) => {
      // Scrolling within the overlay's own content (e.g. a long device list)
      // must not dismiss it — only scrolling the page behind it should.
      if (isInsideOverlay(e.target)) return;
      if (startTarget === null) {
        startTarget = e.target;
        startY = getScrollY(e.target);
        return;
      }
      if (e.target !== startTarget) return;
      if (Math.abs(getScrollY(e.target) - startY) > SCROLL_THRESHOLD) onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isExpanded, onClose]);

  // Handle mouse leave - call immediately
  const handleMouseLeave = useCallback(() => {
    onMouseLeave?.();
  }, [onMouseLeave]);

  const transformOrigin = position === 'left'
    ? 'top left'
    : position === 'right'
      ? 'top right'
      : 'top center';

  // Render a placeholder in the DOM tree to get parent reference
  // The actual overlay is rendered via portal
  return (
    <>
      <div ref={parentRef} className="hidden" />
      {shouldRender && createPortal(
        <div
          className="fixed z-[10018] pointer-events-auto"
          style={{
            left: coords.x,
            // Anchor overlay's content to sit TOP_OFFSET px below the widget's
            // top edge (accounting for the 10px wrapper padding ring). Clamp
            // so it never draws above the viewport.
            top: Math.max(0, coords.y - PADDING + TOP_OFFSET),
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
