import React, { useRef, useState, useLayoutEffect, useCallback, useContext, useEffect, createContext } from 'react';
import { createPortal } from 'react-dom';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { overlayScrim } from '@/lib/overlay-scrim';
import { registerPanelElevation } from '@/lib/overlay-elevation';

export interface ExpandedOverlayProps {
  isExpanded: boolean;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Overlay panel width in px (clamped to the viewport). */
  width?: number;
  /**
   * Base stacking level for the scrim; the panel sits one above it. Defaults to
   * the dashboard's, which is deliberately BELOW dialogs — right until a widget
   * is expanded from inside one. The portal target is document.body either way,
   * so the dialog is a sibling rather than an ancestor and simply paints over
   * it. Only the caller knows it is inside a dialog, the same way SheetContent
   * takes overlayClassName.
   */
  zIndex?: number;
  /**
   * Space to keep clear at the bottom of the viewport, in px.
   *
   * The clamp below otherwise parks a tall panel a few pixels off the bottom
   * edge — right on top of the pinned tab bar, which is what opens these in the
   * first place when a tab is the trigger.
   */
  bottomInset?: number;
  /**
   * Centre the panel in the viewport rather than anchoring it to its trigger.
   *
   * For the pinned tab bar, where the trigger itself is on its way to the
   * middle: the chip you press is scrolled to the centre, so the panel's
   * destination is known before the journey starts. Anchoring it to a moving
   * target meant it set off from wherever the chip happened to be — off the
   * side of the screen, for a chip that started there — and chased it.
   */
  centred?: boolean;
  children: React.ReactNode;
}

/** Dashboard default: above the widget grid, below dialogs. */
const DEFAULT_Z = 10017;

// Carries the caller's elevation down to nested overlays. Portals preserve React
// context, so a per-accessory overlay opened from inside an already-open group
// overlay stacks above it instead of dropping back to the dashboard default.
const OverlayZContext = createContext<number | null>(null);

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
// If a resize leaves the pointer outside and it never comes back, the panel
// should not sit there indefinitely.
const RESIZE_ABANDON_MS = 5000;
// How long to keep watching for the click belonging to the pointerdown that
// dismissed the overlay. A pointerdown does not always produce one — a drag, a
// cancelled touch, a secondary button — so the wait has to give up.
const DISMISS_CLICK_GRACE_MS = 400;
// How long a press may be held before its release is written off entirely. Only
// reached when no pointerup or pointercancel ever arrives.
const DISMISS_HOLD_MAX_MS = 10000;

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

  // Clamp to the viewport, whatever the trigger is doing.
  //
  // The branches above align the panel to the trigger's own edge, which assumes
  // the trigger is on screen. A pinned tab need not be: the bar scrolls, so a
  // chip with a long name can be half off the side when you press it — and
  // `rect.left` is then negative, which put the panel off the same edge and
  // left half the widget unreachable. The panel's footprint is its width plus
  // the 10px ring the wrapper draws around it.
  const footprint = overlayWidth + PADDING * 2;
  x = Math.max(0, Math.min(x, viewportRight - footprint));

  return { position, x, y: widgetTopY };
};

export const ExpandedOverlay: React.FC<ExpandedOverlayProps> = ({ isExpanded, onClose, onMouseEnter, onMouseLeave, width, zIndex, bottomInset = 0, centred = false, children }) => {
  const inheritedZ = useContext(OverlayZContext);
  const baseZ = zIndex ?? inheritedZ ?? DEFAULT_Z;

  // Publish where this panel sits while it is up, so a dialog its action bar
  // opens can clear it. Only matters when the panel has been raised ABOVE
  // dialog level to escape a dialog it lives inside — which is exactly when
  // the dialog it opens would otherwise land underneath it. The `+ 1` is the
  // panel itself; `baseZ` is only its scrim.
  useEffect(() => {
    if (!isExpanded) return;
    return registerPanelElevation(baseZ + 1);
  }, [isExpanded, baseZ]);
  const parentRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The last placement, including ones written straight to the DOM. */
  const coordsRef = useRef({ x: 0, y: 0 });
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
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const abandonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The resize observer is set up once and must not capture stale props, so the
  // two things its timer needs are read through refs.
  const onMouseLeaveRef = useRef<(() => void) | undefined>(undefined);
  const isPointerOutsideRef = useRef<(x: number, y: number) => boolean>(() => true);
  const { isDarkBackground } = useBackgroundContext();
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

  /**
   * Put the panel where its trigger is, wherever that is now. Called when the
   * overlay opens and on every frame of a scroll that carries the trigger.
   *
   * `viaDom` writes straight to the node instead of through state. A scroll
   * emits an event per frame, and a `setState` per frame re-renders the widget
   * inside the panel — which is why the panel juddered across behind a bar that
   * was moving smoothly. Placement is one number; it does not need React.
   */
  const placeAgainstTrigger = useCallback((viaDom = false) => {
    const parent = parentRef.current?.parentElement ?? null;
    if (!parent) return;
    const anchored = getOverlayPositionAndCoords(parent, effectiveWidth);
    const pos = centred ? 'center' as const : anchored.position;
    const x = centred
      ? Math.max(0, (window.innerWidth - (effectiveWidth + PADDING * 2)) / 2)
      : anchored.x;
    const y = anchored.y;
    if (viaDom && panelRef.current) {
      panelRef.current.style.left = `${x}px`;
      coordsRef.current = { x, y };
      return;
    }
    setPosition(pos);
    setCoords({ x, y });
    coordsRef.current = { x, y };
  }, [effectiveWidth, centred]);

  // Calculate position on mount, before animation
  useLayoutEffect(() => {
    if (isExpanded && shouldRender && parentRef.current) {
      placeAgainstTrigger();
      // Trigger ready state after position is set
      requestAnimationFrame(() => {
        setReady(true);
      });
    }
  }, [isExpanded, shouldRender, placeAgainstTrigger]);

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

      // ...but don't wait forever. If the pointer never returns, close.
      if (abandonTimerRef.current) clearTimeout(abandonTimerRef.current);
      const pointer = lastPointerRef.current;
      if (!pointer || !onMouseLeaveRef.current) return;
      abandonTimerRef.current = setTimeout(() => {
        const p = lastPointerRef.current;
        // Still resting inside the resized panel? Then it was never abandoned.
        if (p && !isPointerOutsideRef.current(p.x, p.y)) {
          leaveArmedRef.current = true;
          return;
        }
        onMouseLeaveRef.current?.();
      }, RESIZE_ABANDON_MS);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (abandonTimerRef.current) clearTimeout(abandonTimerRef.current);
    };
  }, [shouldRender]);

  // The scrim swallows the POINTERDOWN, but a widget expands on CLICK — and the
  // click has not been dispatched yet. By the time it is, the scrim has gone
  // inert for its close animation and is no longer in the hit test.
  //
  // On a desktop browser that is usually survivable: the click target is the
  // common ancestor of the pointerdown and pointerup targets, so it lands on
  // <body> and no widget hears it. WebKit on iOS does not work that way — it
  // hit-tests the touch point at touchend — so the tile underneath receives the
  // click and expands. Which is why this reproduced on a phone and not at a desk.
  //
  // So the dismissal consumes its own gesture: swallow exactly the one click
  // that its pointerdown is about to produce. This lives at component scope
  // rather than inside the dismissal effect below because onClose() flips
  // isExpanded, which tears that effect down in a microtask — long before the
  // click lands — and for the same reason it cannot live on the scrim, which
  // goes inert for its close animation in that very tick.
  const swallowTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const swallowClick = useCallback((ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    // Clear the whole arrangement, not just the timer: a swallow that outlives
    // its component (see the unmount effect below) is the only thing left to
    // tidy up the release listeners it armed.
    disarmClickSwallowRef.current();
  }, []);
  // The click belongs to the pointer's RELEASE, not its press. Timing the grace
  // period from the press means a finger that rests for a beat before lifting
  // outlives it, and its click reaches the tile after all — the same bug again,
  // at the speed of an unhurried tap. So the short grace runs from the release,
  // and the press only arms a long backstop for the gesture that never ends
  // (a cancelled touch, a pointer captured elsewhere). That backstop can afford
  // to be generous: while the pointer is still down no other click can happen,
  // so a swallow waiting through it has nothing of anyone else's to eat.
  const startSwallowTimer = useCallback((ms: number) => {
    if (swallowTimerRef.current) clearTimeout(swallowTimerRef.current);
    swallowTimerRef.current = setTimeout(() => disarmClickSwallowRef.current(), ms);
  }, []);
  const onSwallowRelease = useCallback(() => {
    startSwallowTimer(DISMISS_CLICK_GRACE_MS);
  }, [startSwallowTimer]);
  const disarmClickSwallow = useCallback(() => {
    document.removeEventListener('click', swallowClick, true);
    document.removeEventListener('pointerup', onSwallowRelease, true);
    document.removeEventListener('pointercancel', onSwallowRelease, true);
    if (swallowTimerRef.current) clearTimeout(swallowTimerRef.current);
    swallowTimerRef.current = undefined;
  }, [swallowClick, onSwallowRelease]);
  // The timer is armed before disarmClickSwallow exists, so it reaches the
  // current one through a ref rather than capturing a stale closure.
  const disarmClickSwallowRef = useRef(disarmClickSwallow);
  useEffect(() => { disarmClickSwallowRef.current = disarmClickSwallow; });
  const armClickSwallow = useCallback(() => {
    document.addEventListener('click', swallowClick, { capture: true, once: true });
    document.addEventListener('pointerup', onSwallowRelease, { capture: true, once: true });
    document.addEventListener('pointercancel', onSwallowRelease, { capture: true, once: true });
    startSwallowTimer(DISMISS_HOLD_MAX_MS);
  }, [swallowClick, onSwallowRelease, startSwallowTimer]);
  // Unmount must not cancel a swallow that is already armed.
  //
  // Not every caller keeps this component mounted across a close. The pinned
  // tab bar renders `{isOpen && <ExpandedOverlay isExpanded ...>}`, so onClose()
  // flips isOpen and the whole overlay — scrim, listeners and all — is gone in
  // the same tick as the pointerdown that dismissed it. Tearing the swallow
  // down there threw away the tap it had just committed to spending, and the
  // click landed on the tile underneath: fixed for a widget in the list, still
  // broken for a pinned one, which is exactly how it presented.
  //
  // The armed listeners hold no React state and disarm themselves — on the
  // click, or on their own timer if none comes — so they are safe to outlive
  // the component that armed them.
  useEffect(() => () => {
    if (!swallowTimerRef.current) disarmClickSwallowRef.current();
  }, []);

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

    // Anything painted ABOVE this overlay owns the events that land on it —
    // they are not "outside", they belong to whatever is on top.
    //
    // The panel's own action bar opens dialogs (analytics, prices, share), and
    // a dialog portals to the body at z-[10050], well clear of the dashboard's
    // 10018. Without this, a tap on that dialog read as a tap on the backdrop:
    // the panel dismissed — the blurred scrim vanishing out from under a window
    // that was still there — and, worse, the dialog then would not close. Radix
    // defers a TOUCH pointer-down-outside to the click that follows it, and the
    // swallow armed below eats exactly that click from document capture, so the
    // dialog never heard the tap meant to dismiss it. (With a mouse Radix acts
    // on the pointerdown itself, which is why this only ever reproduced on a
    // touch screen.)
    //
    // Nested overlays sit above their parent by the same rule: elevation, not
    // DOM containment, is what decides — a nested panel is a portal sibling, so
    // `contains` above can never see it.
    const isAboveOverlay = (target: EventTarget | null): boolean => {
      const node = target as Node | null;
      let el: Element | null = node instanceof Element ? node : node?.parentElement ?? null;
      while (el && el !== document.body && el !== document.documentElement) {
        // 'auto' parses to NaN — an unpositioned wrapper says nothing about
        // stacking, so keep walking up to a layer that does.
        const z = Number(window.getComputedStyle(el).zIndex);
        if (Number.isFinite(z) && z > baseZ + 1) return true;
        el = el.parentElement;
      }
      return false;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (isInsideOverlay(e.target)) return;
      if (isAboveOverlay(e.target)) return;
      onClose();
      armClickSwallow();
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
      // must not dismiss it — only scrolling the page behind it should. A
      // scrollable dialog above it is not the page behind it either.
      if (isInsideOverlay(e.target)) return;
      if (isAboveOverlay(e.target)) return;

      // A scroller that CONTAINS the trigger is not the page sliding out from
      // under this panel — it is the trigger being carried somewhere, and the
      // panel's job is to go with it. The pinned tab bar centres the chip you
      // pressed, and the widget rides across as it travels; dismissing on that
      // would close the panel the same press had just opened.
      const node = e.target as Node | null;
      if (triggerEl && node && node !== triggerEl && 'contains' in node &&
          (node as Element).contains(triggerEl)) {
        placeAgainstTrigger(true);
        return;
      }
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
  }, [isExpanded, onClose, armClickSwallow, baseZ, placeAgainstTrigger]);

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

  useEffect(() => {
    onMouseLeaveRef.current = onMouseLeave;
    isPointerOutsideRef.current = isPointerOutside;
  });

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
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (!isPointerOutside(e.clientX, e.clientY)) {
        leaveArmedRef.current = true;
        if (abandonTimerRef.current) {
          clearTimeout(abandonTimerRef.current);
          abandonTimerRef.current = null;
        }
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
    ? viewportH - panelHeight - PADDING * 2 - 8 - bottomInset
    : anchoredTop;
  const top = Math.max(8, Math.min(anchoredTop, Math.max(8, lowestTop)));

  /**
   * How tall the panel may be before it has to scroll.
   *
   * `top` is clamped to stay on screen, but nothing clamped the height — so a
   * panel taller than the room above `bottomInset` simply ran past it. From the
   * pinned tab bar that put its bottom edge under the bar, which is painted
   * above it, and a tap meant for the widget pressed a tab instead. It showed
   * on service groups and shortcuts because their cards are tall; an accessory
   * panel was never long enough to reach.
   */
  const maxPanelHeight = viewportH
    ? Math.max(160, viewportH - top - PADDING * 2 - 8 - bottomInset)
    : undefined;

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
          {/* Subtle scrim behind the panel. It swallows the tap that dismisses
              the overlay: the pointerdown lands here, the document-capture
              handler above sees a target outside the panel and closes, and
              whatever sits underneath never hears about it. It used to be
              pointer-events-none, so dismissing also pressed the widget you
              happened to dismiss over — a blurred, unreachable-looking backdrop
              that still actuated devices. One tap now means one thing.
              Interactive only once it is actually painted, so the 150ms close
              animation doesn't eat the next tap.

              Every overlay draws one, at its own elevation: a nested panel sits
              two above its parent, so its scrim lands between them. Expanding a
              member of an already-expanded service group therefore pushes the
              group's panel back exactly the way the group pushed the wallpaper
              back — the alternative was a lit, fully legible panel directly
              under a panel that had taken over from it. The wallpaper ends up
              under both, which is the point: it is two rooms away now. */}
          <div
            ref={scrimRef}
            aria-hidden
            // Blocking the pointer also blocks scrolling the page behind, and
            // the scroll-past-40px dismissal with it. A wheel over the
            // backdrop means the same thing a tap does.
            onWheel={() => onClose()}
            style={{ zIndex: baseZ }}
            // Opacity is NOT tied to `ready`. That flag waits for the panel to
            // be measured, which waits for the widget inside it to render —
            // heavy — so the blur arrived a beat after the press instead of
            // with it. The scrim needs no measurement, so it paints at once.
            // Interactivity still waits, so the close animation cannot eat the
            // next tap.
            className={`fixed-full-screen ${overlayScrim(isDarkBackground)} transition-opacity duration-fast ease-standard ${
              isClosing ? 'opacity-0' : 'opacity-100'
            } ${ready && !isClosing ? 'pointer-events-auto' : 'pointer-events-none'}`}
          />
          <div
            ref={panelRef}
            // Marks this as expanded-widget content even though the portal puts
            // it outside the widget's own subtree. Dashboard's collapse-on-
            // mouse-leave asks whether focus is still inside a widget before
            // closing, and without the marker a field in here looked like focus
            // had left — so a half-typed value unmounted before it could commit.
            data-expandable-widget
            // Glide when the panel resizes itself. Not while opening — the
            // position is being established then, and easing it would drag the
            // panel across the screen on every expand.
            className={`fixed pointer-events-auto ${
              ready && !isClosing ? 'transition-[top] duration-base ease-standard' : ''
            }`}
            style={{
              zIndex: baseZ + 1,
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
                // No blanket pointer cursor. The panel is a surface to work on,
                // not a thing to click, and `[&_*]` painted every descendant —
                // titles, readouts, the padding between controls — as though it
                // were. Controls bring their own: buttons and sliders already
                // set cursor-pointer, so the pointer now means something.
                // The panel grows out of the tile it came from, anchored at the
                // corner nearest it. It scaled before, but from 90% over 150ms
                // — small enough and quick enough that it read as the contents
                // arriving rather than the box opening. Starting smaller and
                // taking a beat longer makes it legible as one movement.
                //
                // Deliberately still a transform on this container and not an
                // animation of its width and height: laying the panel out
                // repeatedly would reflow every control inside it on each
                // frame, and the glass is already handled by fading its own
                // layer separately (see below).
                className={`relative max-w-[calc(100vw-2rem)] rounded-2xl overflow-visible cursor-default transition-transform duration-base ease-standard ${
                  ready && !isClosing
                    ? 'scale-100'
                    : 'scale-[0.82]'
                }`}
                style={{ transformOrigin, width: effectiveWidth, maxHeight: maxPanelHeight }}
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
                <div
                  // Scrolls rather than overflowing: whatever it holds, the
                  // panel stops where `bottomInset` says it must.
                  className={`relative overflow-y-auto scrollbar-hidden transition-opacity duration-fast ease-standard ${
                    ready && !isClosing ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ maxHeight: maxPanelHeight }}
                >
                  {/* Nested overlays inherit the elevation rather than dropping
                      back to the dashboard default — a group expanded inside a
                      dialog would otherwise send its per-accessory overlay
                      behind that dialog, which is the bug this prop fixes. The
                      +2 leaves the nested scrim a rung of its own at baseZ + 2,
                      directly over this panel at baseZ + 1. */}
                  <OverlayZContext.Provider value={baseZ + 2}>
                    {children}
                  </OverlayZContext.Provider>
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
