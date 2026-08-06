import React, { useRef, useState, useLayoutEffect, useCallback, useContext, useEffect, createContext } from 'react';
import { createPortal } from 'react-dom';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { useIsMobile } from '@/hooks/use-mobile';

export interface ExpandedOverlayProps {
  isExpanded: boolean;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Overlay panel width in px (clamped to the viewport). */
  width?: number;
  children: React.ReactNode;
}

// Portals preserve React context, so a per-accessory overlay opened from inside
// an already-open group overlay sees depth 1 and skips its scrim.
const OverlayDepthContext = createContext(0);

// Portrait panels are narrower so the hero control reads as a tall bar; on
// desktop the hero stands beside its secondary controls and needs the width.
const PORTRAIT_WIDTH = 300;
const LANDSCAPE_WIDTH = 380;
const PADDING = 10;
// Offset the overlay content down from the widget's top edge so it visually
// starts just below the top of the compact trigger rather than flush with it.
const TOP_OFFSET = 16;
// How long after a resize a pointer-leave is treated as the panel having moved
// rather than the user having left.
const RESIZE_GRACE_MS = 600;

// Calculate overlay position and coordinates based on parent element.
// The overlay is top-aligned with the trigger so it always opens downward from
// the widget's top edge — never pushed above the viewport regardless of content height.
const getOverlayPositionAndCoords = (element: HTMLElement | null, overlayWidth: number): {
  position: 'left' | 'center' | 'right';
  x: number;
  y: number;
} => {
  if (!element) return { position: 'center', x: 0, y: 0 };

  const rect = element.getBoundingClientRect();

  // Calculate where overlay would be if centered on the widget
  const widgetCenterX = rect.left + rect.width / 2;
  const widgetTopY = rect.top;
  const overlayLeft = widgetCenterX - overlayWidth / 2 - PADDING;
  const overlayRight = widgetCenterX + overlayWidth / 2 + PADDING;

  // Check against viewport edges
  const viewportRight = window.innerWidth;

  let position: 'left' | 'center' | 'right' = 'center';
  let x = widgetCenterX - overlayWidth / 2 - PADDING; // Default: centered

  if (overlayLeft < 0) {
    position = 'left';
    x = rect.left - PADDING;
  } else if (overlayRight > viewportRight) {
    position = 'right';
    x = rect.right - overlayWidth - PADDING;
  }

  return { position, x, y: widgetTopY };
};

export const ExpandedOverlay: React.FC<ExpandedOverlayProps> = ({ isExpanded, onClose, onMouseEnter, onMouseLeave, width, children }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<'left' | 'center' | 'right'>('center');
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [panelHeight, setPanelHeight] = useState(0);
  // When the panel last changed size. A leave triggered within this window was
  // caused by the boundary moving, not by the user going anywhere.
  const lastResizeRef = useRef(0);
  // Whether a leave should close the panel. Disarmed whenever the panel resizes,
  // and re-armed only once the pointer is inside it again.
  const leaveArmedRef = useRef(false);
  const { isDarkBackground } = useBackgroundContext();
  const depth = useContext(OverlayDepthContext);
  const isMobile = useIsMobile();

  // Clamp before the position math so narrow viewports get correct alignment,
  // not just a squeezed panel.
  const requestedWidth = width ?? (isMobile !== false ? PORTRAIT_WIDTH : LANDSCAPE_WIDTH);
  const effectiveWidth = typeof window !== 'undefined'
    ? Math.min(requestedWidth, window.innerWidth - 32)
    : requestedWidth;

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
      const { position: pos, x, y } = getOverlayPositionAndCoords(parent, effectiveWidth);
      setPosition(pos);
      setCoords({ x, y });
      // Trigger ready state after position is set
      requestAnimationFrame(() => {
        setReady(true);
      });
    }
  }, [isExpanded, shouldRender, effectiveWidth]);

  // Measure the panel: a portrait panel with a hero control is tall enough to
  // run off the bottom of a phone, and top-aligning to the trigger would leave
  // half of it unreachable.
  //
  // Observed rather than sampled, because the panel resizes on its own — switch
  // a device on and its controls collapse open over 200ms. A one-shot
  // measurement caught the old height and the panel sat wrong until some later
  // render happened to fix it.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!shouldRender || !el) return;
    const measure = () => {
      lastResizeRef.current = performance.now();
      // The panel just moved out from under the pointer. Until the pointer is
      // deliberately back inside, nothing it does counts as leaving.
      leaveArmedRef.current = false;
      setPanelHeight(el.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldRender]);

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
  // Is the pointer genuinely away from both the panel and the tile it came from?
  // The tolerance covers the gap between them and sub-pixel rounding.
  const isPointerOutside = useCallback((x: number, y: number) => {
    const within = (rect?: DOMRect | null) =>
      !!rect && x >= rect.left - 8 && x <= rect.right + 8 && y >= rect.top - 8 && y <= rect.bottom + 8;
    return !within(contentRef.current?.getBoundingClientRect())
      && !within(parentRef.current?.parentElement?.getBoundingClientRect());
  }, []);

  // mouseleave fires whenever the boundary crosses the pointer — including when
  // the panel resizes itself under a cursor that never moved, which is exactly
  // what happens when you switch a device on and its controls appear. Treat it
  // as a leave only if the pointer really is outside now.
  // Switching a device on or off grows or shrinks the panel, and a shrink can
  // leave a perfectly still cursor outside it. The browser reports that as a
  // leave, which closed the panel the instant you used it. Ignore leaves for a
  // moment after a resize, so the pointer has a chance to be somewhere on
  // purpose — and give the user time to move back in.
  const leaveFollowsResize = useCallback(
    () => performance.now() - lastResizeRef.current < RESIZE_GRACE_MS,
    [],
  );

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    if (!leaveArmedRef.current) return;
    if (leaveFollowsResize()) return;
    if (!isPointerOutside(e.clientX, e.clientY)) return;
    onMouseLeave?.();
  }, [isPointerOutside, leaveFollowsResize, onMouseLeave]);

  const handleMouseEnter = useCallback(() => {
    leaveArmedRef.current = true;
    onMouseEnter?.();
  }, [onMouseEnter]);

  // Because a swallowed mouseleave never fires again, moving away afterwards has
  // to be caught here. A resize produces no pointermove, so this cannot be
  // triggered by the panel changing shape.
  useEffect(() => {
    if (!isExpanded || !onMouseLeave) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (!isPointerOutside(e.clientX, e.clientY)) {
        leaveArmedRef.current = true;
        return;
      }
      // Outside — but only meaningful if the pointer had been inside since the
      // panel last changed shape. A panel that shrank away from a resting
      // cursor should not close the moment that cursor twitches.
      if (!leaveArmedRef.current) return;
      if (leaveFollowsResize()) return;
      onMouseLeave();
    };
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, [isExpanded, isPointerOutside, leaveFollowsResize, onMouseLeave]);

  // Anchor below the trigger's top edge, then pull back up if that would push
  // the panel past the bottom of the viewport.
  const anchoredTop = coords.y - PADDING + TOP_OFFSET;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 0;
  const lowestTop = viewportH && panelHeight
    ? viewportH - panelHeight - PADDING * 2 - 8
    : anchoredTop;
  const top = Math.max(8, Math.min(anchoredTop, Math.max(8, lowestTop)));

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
        <>
          {/* Subtle scrim behind the panel. pointer-events-none keeps the
              pointerdown-outside dismissal working (tapping another widget
              closes this overlay AND opens that one). Only the outermost
              overlay dims — nested overlays (group → accessory) skip it. */}
          {depth === 0 && (
            <div
              aria-hidden
              className={`fixed-full-screen z-[10017] pointer-events-none backdrop-blur-[1px] transition-opacity duration-fast ease-standard ${
                isDarkBackground ? 'bg-black/15' : 'bg-black/[0.07]'
              } ${ready && !isClosing ? 'opacity-100' : 'opacity-0'}`}
            />
          )}
          <div
            // Marks this as expanded-widget content even though the portal puts
            // it outside the widget's own subtree. Dashboard's collapse-on-
            // mouse-leave asks whether focus is still inside a widget before
            // closing, and without the marker a field in here looked like focus
            // had left — so a half-typed value unmounted before it could commit.
            data-expandable-widget
            // Glide when the panel resizes itself. Not while opening — the
            // position is being established then, and easing it would drag the
            // panel across the screen on every expand.
            className={`fixed z-[10018] pointer-events-auto ${
              ready && !isClosing ? 'transition-[top] duration-base ease-standard' : ''
            }`}
            style={{
              left: coords.x,
              // Anchor overlay's content to sit TOP_OFFSET px below the widget's
              // top edge (accounting for the 10px wrapper padding ring). Clamp
              // so it never draws above the viewport.
              top,
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="p-[10px]">
              <div
                ref={contentRef}
                className={`relative max-w-[calc(100vw-2rem)] rounded-2xl overflow-visible cursor-pointer [&_*]:cursor-pointer transition-transform duration-fast ease-standard ${
                  ready && !isClosing
                    ? 'scale-100'
                    : 'scale-90'
                }`}
                style={{ transformOrigin, width: effectiveWidth }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    e.stopPropagation();
                    onClose();
                  }
                }}
              >
                {/* Blur background layer - animates independently to avoid breaking children's backdrop-blur */}
                <div className={`absolute inset-0 rounded-2xl shadow-xl transition-opacity duration-fast ease-standard ${
                  isDarkBackground ? 'material-thin-dark' : 'material-thin shadow-black/10'
                } ${
                  ready && !isClosing ? 'opacity-100' : 'opacity-0'
                }`} />
                {/* Content layer - no opacity animation to preserve backdrop-blur */}
                <div className={`relative transition-opacity duration-fast ease-standard ${
                  ready && !isClosing ? 'opacity-100' : 'opacity-0'
                }`}>
                  <OverlayDepthContext.Provider value={depth + 1}>
                    {children}
                  </OverlayDepthContext.Provider>
                </div>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
};
