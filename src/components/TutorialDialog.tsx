import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { ExternalLink, ChevronLeft, ChevronRight, Sparkles, X, Loader2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const DOCS_BASE = 'https://docs.homecast.cloud';

function openDocLink(path: string) {
  const url = `${DOCS_BASE}${path}`;
  const w = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; url?: string }) => void } } } };
  if (w.webkit?.messageHandlers?.homecast) {
    w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url });
  } else {
    window.open(url, '_blank');
  }
}

interface OpenTriggerSpec {
  target: string; // data-tour of the element to invoke
  action?: 'click' | 'contextmenu'; // default: click
}

interface TourStep {
  target: string; // data-tour attribute value, or '' for centered card
  mobileTarget?: string; // Alternative target on mobile (e.g., hamburger button instead of sidebar)
  // Extra data-tour selectors to spotlight alongside `target`. The primary
  // `target` still drives card positioning and the `mobileTarget` override;
  // additional targets are highlight-only and silently skipped if missing.
  additionalTargets?: string[];
  // Chained triggers that fire if `target` isn't yet in the DOM. Each one opens
  // a container so the next is reachable (e.g. open the sidebar sheet, then
  // right-click the first home). On step exit we press Escape once per fired
  // trigger to unwind.
  openTriggers?: OpenTriggerSpec[];
  // Shorthand for a single click trigger — equivalent to openTriggers: [{ target }].
  openTrigger?: string;
  title: string;
  description: string;
  mobileDescription?: string; // Alternative description on mobile
  docPath?: string;
  // Position hint for the floating card relative to the highlighted element
  position?: 'bottom' | 'right' | 'left' | 'center';
}

const STEPS: TourStep[] = [
  {
    target: '',
    title: 'Welcome to Homecast',
    description: "Let's take a quick tour of your dashboard. We'll highlight the key areas so you know where everything is.",
    position: 'center',
  },
  {
    target: 'sidebar-homes',
    openTrigger: 'sidebar-menu',
    title: 'Your Homes',
    description: 'Your Apple Home houses appear here. Select a home to see its rooms, then pick a room to filter your devices.',
    docPath: '/getting-started/dashboard',
    position: 'right',
  },
  {
    target: 'widget-area',
    title: 'Device Widgets',
    description: 'Each device appears as a widget. Tap toggles to switch devices on or off, and drag sliders to adjust brightness, temperature, or position.',
    docPath: '/getting-started/dashboard',
    position: 'bottom',
  },
  {
    // Stage 1: spotlight both share entry points (the device widget area as
    // the primary so the card lands directly below the widgets, and the
    // sidebar home/room as an additional highlight). Stage 2 then
    // demonstrates the right-click flow on the home/room.
    target: 'widget-area',
    additionalTargets: ['sidebar-home-item'],
    openTriggers: [
      { target: 'sidebar-menu', action: 'click' },
    ],
    title: 'Share homes, rooms, or devices',
    description: 'Right-click any home or room in the sidebar — or any device widget — to open its share menu.',
    mobileDescription: 'Long-press any home or room in the sidebar — or any device widget — to open its share menu.',
    position: 'bottom',
  },
  {
    // Stage 2: open the context menu and spotlight the Share row.
    target: 'sidebar-home-share-item',
    openTriggers: [
      { target: 'sidebar-menu', action: 'click' },
      { target: 'sidebar-home-item', action: 'contextmenu' },
    ],
    title: 'Then choose Share',
    description: 'Pick Admin, Control or View-only and they\'ll get an email invite.',
    position: 'right',
  },
  {
    target: 'sidebar-collections',
    openTrigger: 'sidebar-menu',
    title: 'Collections',
    description: 'Group devices from different rooms into custom views. Right-click a home or use the menu to create one — great for "All Lights" or "Bedtime" shortcuts.',
    mobileDescription: 'Group devices from different rooms into custom views like "All Lights" or "Bedtime" — right here below your homes.',
    docPath: '/guides/collections',
    position: 'right',
  },
  {
    target: 'automations',
    title: 'Automations',
    description: 'Automations run your devices on a trigger — time of day, a sensor changing state, a webhook, or sunrise/sunset. Open a home\'s view to create one from scratch or use a template.',
    position: 'bottom',
  },
  {
    target: 'header-menu',
    title: 'Settings & More',
    description: 'Open this menu any time for Settings, to switch homes or sign out, or to replay this tutorial from Settings → Account.',
    docPath: '/getting-started/account',
    position: 'bottom',
  },
];

interface TutorialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  // Notifies the host (Dashboard) to swap real data for a fixed demo dataset
  // so every step's spotlight lands on a guaranteed-present DOM element.
  onDemoActiveChange?: (active: boolean) => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TutorialDialog({ open, onOpenChange, onComplete, onDemoActiveChange }: TutorialDialogProps) {
  const [step, setStep] = useState(0);
  const [targetRects, setTargetRects] = useState<TargetRect[]>([]);
  const targetRect = targetRects[0] ?? null;
  // True once we either measured the target or gave up waiting for it. We hide
  // the card while this is false to avoid a flash at the wrong position.
  const [readyToShow, setReadyToShow] = useState(true);
  // True from the moment the dialog opens until the host dashboard has
  // rendered demo data (sentinel = `[data-tour="widget-area"]` visible). On
  // a slow first paint — Apollo queries still in flight, sheet animating in,
  // demo data not yet swapped — this prevents the welcome card from rendering
  // over a half-loaded dashboard, and we show a small spinner instead.
  const [warming, setWarming] = useState(false);
  const isViewportMobile = useIsMobile();
  // Mac app users always have right-click available, even at narrow widths.
  // Treat them as desktop for instructional copy that distinguishes long-press
  // from right-click.
  const isInMacApp = typeof window !== 'undefined' && !!(window as Window & { isHomecastMacApp?: boolean }).isHomecastMacApp;
  const isMobile = isViewportMobile && !isInMacApp;
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Toggle demo data on the host while the tutorial is open. Reset step to 0
  // when the dialog opens (false → true).
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setWarming(true);
    onDemoActiveChange?.(true);
    return () => { onDemoActiveChange?.(false); };
  }, [open, onDemoActiveChange]);

  // Wait for a sentinel target (widget-area) to appear before clearing the
  // warming flag. This blocks step 0 from rendering until the dashboard has
  // actually committed the demo data — avoids the tutorial flashing over a
  // half-loaded layout. Times out after 6s so we never hang forever.
  useEffect(() => {
    if (!open || !warming) return;
    const start = Date.now();
    let raf = 0;
    const isVisible = (sel: string) => {
      const list = document.querySelectorAll(sel);
      for (const el of list) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
      return false;
    };
    const check = () => {
      // Either spotlight target works as a sentinel — whichever paints first
      // means the host has committed demo data and is ready for the tour.
      if (isVisible('[data-tour="widget-area"]') || isVisible('[data-tour="sidebar-homes"]')) {
        setWarming(false);
        return;
      }
      if (Date.now() - start > 6000) {
        setWarming(false);
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [open, warming]);

  // Block all user-generated pointer/click input outside the tutorial card.
  // Programmatic events the tutorial itself dispatches (`el.click()`,
  // `dispatchEvent(new PointerEvent(...))`) have `isTrusted === false`, so the
  // tutorial's own opening sequence still works. Real user clicks are absorbed
  // — they can't toggle a demo widget, dismiss the sheet, or otherwise mess
  // with the underlying UI while the tour is running.
  useEffect(() => {
    if (!open) return;
    const blocker = (e: Event) => {
      if (!(e as { isTrusted?: boolean }).isTrusted) return;
      const target = e.target as Node | null;
      if (target && cardRef.current && cardRef.current.contains(target)) return;
      e.stopImmediatePropagation();
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };
    const events = [
      'pointerdown', 'pointerup', 'mousedown', 'mouseup',
      'click', 'dblclick', 'auxclick', 'contextmenu',
      'touchstart', 'touchend',
    ];
    events.forEach(name => document.addEventListener(name, blocker, true));
    return () => {
      events.forEach(name => document.removeEventListener(name, blocker, true));
    };
  }, [open]);
  const rafRef = useRef<number>(0);
  // Last rects we wrote to state. The rAF measurement loop compares against
  // this and skips setState when nothing changed — without that gate, every
  // frame produces a fresh array and re-fires the card's `transition-all`
  // 300ms animation, which looks like jerky movement.
  const prevRectsRef = useRef<TargetRect[]>([]);
  // Currently-open triggers (target + opening action), in opening order.
  // Persists across steps so consecutive steps requesting the same opener
  // don't cause a close-then-reopen flicker. The action is used to choose how
  // to close: click-opened (Sheet, DropdownMenu) toggles closed by clicking
  // again; contextmenu-opened menus close on Escape.
  const openedTriggersRef = useRef<{ target: string; action: 'click' | 'contextmenu' }[]>([]);
  // Bumped whenever the effect re-runs. Async callbacks (rAF chains for
  // closeNext / fireNextTrigger) compare against the captured epoch and bail
  // out if they're now stale.
  const triggerEpochRef = useRef(0);

  const currentStep = STEPS[step];
  // On mobile, use mobileTarget if available (e.g., hamburger button instead of sidebar)
  const effectiveTarget = (isMobile && currentStep.mobileTarget) || currentStep.target;
  const isCenter = !effectiveTarget || !targetRect;

  // Measure and track the target element
  useEffect(() => {
    const findVisible = (tour: string): HTMLElement | null => {
      const list = document.querySelectorAll(`[data-tour="${tour}"]`);
      for (const c of list) {
        const r = c.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return c as HTMLElement;
      }
      return null;
    };

    // Close a trigger by dispatching Escape. We can't "click the trigger
    // again" to close — Radix Dialog (which Sheet uses) only ever fires
    // open=true from its trigger, so a second click leaves the sheet open.
    // Escape works for Sheet, Dialog, DropdownMenu and ContextMenu alike;
    // when multiple layers are stacked, Radix only dismisses the topmost
    // per Escape, so the closeNext loop spaces them by 120ms.
    const makeEscape = () => new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
    });
    const closeTrigger = (_entry: { target: string; action: 'click' | 'contextmenu' }) => {
      // Dispatch Escape broadly. Radix DismissableLayer attaches keydown on
      // ownerDocument and gates dismissal on pointer-events being enabled for
      // the layer; firing on multiple targets covers stacked layers (Sheet
      // under ContextMenu) and any focus state.
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) active.dispatchEvent(makeEscape());
      document.body.dispatchEvent(makeEscape());
      document.dispatchEvent(makeEscape());
      // Also try clicking the topmost dialog/menu's built-in close button if
      // present — Radix Sheet ships an X button as a child of its content.
      const layers = Array.from(document.querySelectorAll('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]'));
      const topmost = layers[layers.length - 1] as HTMLElement | undefined;
      if (topmost) {
        const closeBtn = topmost.querySelector('button[aria-label="Close" i], button[data-radix-collection-item][data-state]') as HTMLElement | null;
        if (closeBtn) closeBtn.click();
      }
    };

    if (!open) {
      // Tutorial closed: unwind any triggers we still have open, in reverse
      // opening order so nested layers (e.g. context menu over sheet) come
      // off the top first.
      const toUnwind = [...openedTriggersRef.current].reverse();
      openedTriggersRef.current = [];
      let i = 0;
      const fireClose = () => {
        if (i >= toUnwind.length) return;
        closeTrigger(toUnwind[i]);
        i += 1;
        if (i < toUnwind.length) setTimeout(fireClose, 400);
      };
      fireClose();
      return;
    }

    // For target-less (welcome) steps, snap to center immediately. For
    // targeted steps, KEEP the previous step's rects in state so the card
    // and spotlight glide smoothly to the new target once measurement
    // succeeds — clearing them here would flash the card through the
    // centered intermediate state and produce the jerk we're trying to
    // avoid.
    if (!effectiveTarget) {
      setTargetRects([]);
      prevRectsRef.current = [];
    }
    setReadyToShow(true);

    const triggers: OpenTriggerSpec[] = currentStep.openTriggers
      ?? (currentStep.openTrigger ? [{ target: currentStep.openTrigger }] : []);
    const desiredTargets = triggers.map(t => t.target);

    // Reconcile triggers: close any currently-open trigger that the new step
    // doesn't want (in reverse opening order, so nested layers unwind), and
    // open any new ones the step wants but we don't have. Triggers shared
    // between consecutive steps stay open — no flicker.
    triggerEpochRef.current += 1;
    const myEpoch = triggerEpochRef.current;
    const isStale = () => triggerEpochRef.current !== myEpoch;

    const toClose = [...openedTriggersRef.current].reverse()
      .filter(entry => !desiredTargets.includes(entry.target));
    let closedIdx = 0;
    const closeNext = () => {
      if (isStale()) return;
      if (closedIdx >= toClose.length) {
        // After closing, advance to opening any new triggers.
        startOpening();
        return;
      }
      const entry = toClose[closedIdx];
      closeTrigger(entry);
      const idx = openedTriggersRef.current.findIndex(o => o.target === entry.target);
      if (idx >= 0) openedTriggersRef.current.splice(idx, 1);
      closedIdx += 1;
      // Radix's DismissableLayer Escape only dismisses the highest layer,
      // and the dismissed layer stays in the stack until its exit animation
      // finishes (~250–300ms for Sheet/ContextMenu). 120ms wasn't enough —
      // the next Escape fired while the previous layer was still "highest"
      // and got swallowed. 400ms covers the longest exit animation.
      setTimeout(closeNext, 400);
    };

    let triggerWaitFrames = 0;
    const TRIGGER_WAIT_MAX_FRAMES = 36; // ~600ms at 60fps
    let openIdx = 0;

    const startOpening = () => {
      if (isStale()) return;
      openIdx = 0;
      requestAnimationFrame(fireNextTrigger);
    };

    const fireNextTrigger = () => {
      if (isStale()) return;
      while (openIdx < triggers.length) {
        const spec = triggers[openIdx];
        const action = spec.action ?? 'click';
        if (openedTriggersRef.current.some(o => o.target === spec.target)) {
          // Already open from a previous step — skip.
          openIdx += 1;
          triggerWaitFrames = 0;
          continue;
        }
        const trigEl = findVisible(spec.target);
        if (!trigEl) {
          // Element doesn't exist at all (e.g. mobile-only on desktop) — skip.
          openIdx += 1;
          triggerWaitFrames = 0;
          continue;
        }
        // Element exists; ensure it's actually on-screen before firing. While
        // a Sheet animates in via transform, getBoundingClientRect can return
        // negative coordinates — dispatching at those coords confuses Radix's
        // ContextMenu, which then renders the popover off-screen (top-left).
        const r = trigEl.getBoundingClientRect();
        const onScreen = r.width > 0 && r.height > 0
          && r.right > 0 && r.bottom > 0
          && r.left >= 0 && r.left < window.innerWidth;
        if (!onScreen && triggerWaitFrames < TRIGGER_WAIT_MAX_FRAMES) {
          triggerWaitFrames += 1;
          requestAnimationFrame(fireNextTrigger);
          return;
        }
        triggerWaitFrames = 0;
        openIdx += 1;
        openedTriggersRef.current.push({ target: spec.target, action });
        if (spec.action === 'contextmenu') {
          // Radix's ContextMenu reads event.clientX/clientY from the contextmenu
          // event to anchor its popover. Synthetic MouseEvents in some browsers
          // strip these fields, so the menu lands at (0, 0). Defensive fix:
          // dispatch the event AND patch clientX/clientY/pageX/pageY/screenX/Y
          // onto the event object before bubbling, so any Radix codepath sees
          // the correct coordinates.
          const dispatchEl = (trigEl.firstElementChild as HTMLElement | null) ?? trigEl;
          const wrapperRect = trigEl.getBoundingClientRect();
          const cx = wrapperRect.left + wrapperRect.width / 2;
          const cy = wrapperRect.top + wrapperRect.height / 2;
          const evt = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: cx,
            clientY: cy,
            screenX: cx,
            screenY: cy,
          });
          // Force pageX/pageY too — some browsers compute pageX = clientX +
          // window.scrollX synchronously, but this keeps a clean value.
          try {
            Object.defineProperty(evt, 'pageX', { value: cx + window.scrollX });
            Object.defineProperty(evt, 'pageY', { value: cy + window.scrollY });
          } catch {
            // some envs make these read-only at definition time; ignore
          }
          dispatchEl.dispatchEvent(evt);
        } else {
          // Radix Sheet/DropdownMenu triggers can listen on pointerdown rather
          // than click. Dispatch a full pointer→mouse sequence so any listener
          // shape opens the popup. Fall back to .click() for browsers without
          // PointerEvent (e.g. older jsdom).
          const r = trigEl.getBoundingClientRect();
          const center = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
          try {
            trigEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ...center }));
            trigEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, ...center }));
          } catch {
            // PointerEvent unavailable — mousedown/mouseup as fallback.
            trigEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...center }));
            trigEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, ...center }));
          }
          trigEl.click();
        }
        // Wait a frame so the opener can mount its children before the next.
        if (openIdx < triggers.length) {
          requestAnimationFrame(fireNextTrigger);
        }
        return;
      }
    };

    // Kick off the close-then-open reconcile.
    requestAnimationFrame(closeNext);

    if (!effectiveTarget) {
      // No spotlight target — nothing to measure; just leave triggers in
      // their reconciled state.
      return;
    }

    // Fallback: after this many ms we give up waiting and show the card
    // centered with whatever description the step has, so the tutorial doesn't
    // get stuck on an unloaded/empty Dashboard.
    const fallbackTimer = setTimeout(() => setReadyToShow(true), 800);

    const allTargets = [effectiveTarget, ...(currentStep.additionalTargets ?? [])]
      .filter((t): t is string => !!t);

    const measure = () => {
      // Some data-tour values are duplicated (sidebar-homes, sidebar-collections
      // exist in both the desktop sidebar and the mobile sheet — only one is
      // visible at a time). querySelector returns DOM order, which can pick
      // the hidden one with a 0×0 rect. Walk all candidates and pick the first
      // one with a non-zero rect.
      const pickVisible = (tour: string): { el: Element; rect: DOMRect } | null => {
        const candidates = document.querySelectorAll(`[data-tour="${tour}"]`);
        for (const c of candidates) {
          const r = c.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { el: c, rect: r };
        }
        return null;
      };

      const found = allTargets
        .map(t => pickVisible(t))
        .filter((m): m is { el: Element; rect: DOMRect } => m !== null);

      if (found.length > 0) {
        const next: TargetRect[] = found.map(({ rect }) => ({
          top: rect.top, left: rect.left, width: rect.width, height: rect.height,
        }));
        const prev = prevRectsRef.current;
        const same = prev.length === next.length && next.every((r, i) =>
          r.top === prev[i].top && r.left === prev[i].left
          && r.width === prev[i].width && r.height === prev[i].height
        );
        if (!same) {
          prevRectsRef.current = next;
          setTargetRects(next);
        }
        setReadyToShow(true);
        // Only scroll the primary target into view (card anchors to it).
        // For `position: 'bottom'` steps the card needs ~280px of room below
        // the spotlight, so scroll the target near the top of the viewport
        // rather than centred — otherwise on shorter screens the card gets
        // clamped back over the widgets.
        const primary = found[0];
        const block: ScrollLogicalPosition = currentStep.position === 'bottom' ? 'start' : 'center';
        if (primary.rect.top < 0 || primary.rect.bottom > window.innerHeight) {
          primary.el.scrollIntoView({ behavior: 'smooth', block });
        }
      } else if (prevRectsRef.current.length > 0) {
        prevRectsRef.current = [];
        setTargetRects([]);
      }
      rafRef.current = requestAnimationFrame(measure);
    };

    const timer = setTimeout(() => {
      measure();
    }, 100);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      cancelAnimationFrame(rafRef.current);
      // Triggers are NOT closed here — they're reconciled at the start of
      // the next step's effect (or unwound when `open` becomes false). This
      // is what stops the close-then-reopen flicker between consecutive
      // steps that share an opener.
    };
  }, [open, step, effectiveTarget, currentStep]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      onComplete();
    }
  }, [step, onComplete]);

  const handleBack = useCallback(() => {
    setStep(s => Math.max(0, s - 1));
  }, []);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  if (!open) return null;

  // Compute card position
  const PAD = 12;
  const cardStyle: React.CSSProperties = {};

  if (isCenter) {
    // Centered card
    cardStyle.top = '50%';
    cardStyle.left = '50%';
    cardStyle.transform = 'translate(-50%, -50%)';
  } else if (targetRect) {
    const pos = currentStep.position || 'bottom';
    if (pos === 'right') {
      cardStyle.top = Math.max(PAD, targetRect.top);
      cardStyle.left = targetRect.left + targetRect.width + PAD;
      // On mobile or if card would overflow right, position below instead
      if (isMobile || cardStyle.left + 340 > window.innerWidth) {
        cardStyle.top = targetRect.top + targetRect.height + PAD;
        cardStyle.left = Math.max(PAD, Math.min(targetRect.left, window.innerWidth - 340 - PAD));
      }
    } else if (pos === 'bottom') {
      cardStyle.top = targetRect.top + targetRect.height + PAD;
      cardStyle.left = Math.max(PAD, Math.min(targetRect.left, window.innerWidth - 340 - PAD));
    } else if (pos === 'left') {
      cardStyle.top = Math.max(PAD, targetRect.top);
      cardStyle.left = Math.max(PAD, targetRect.left - 340 - PAD);
    }
    // Clamp to viewport
    if (typeof cardStyle.top === 'number' && cardStyle.top + 250 > window.innerHeight) {
      cardStyle.top = Math.max(PAD, window.innerHeight - 280);
    }
  }

  // SVG mask for spotlight cutout
  const spotlightPad = 8;
  const spotlightRadius = 12;

  // Render via portal so the overlay sits at body level, above Sheet portals
  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: 10040 }}>
      {/* Overlay with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          {/* Blur the mask cutout so the dim → spotlight transition feathers
              softly instead of hard-clipping at the rect edge.

              filterUnits="userSpaceOnUse" with an oversized region keeps the
              blur from getting clipped — the default objectBoundingBox region
              only extends 10% past the cutout's bbox, which Safari clips on
              short or narrow targets where the 12px blur radius spills past
              that buffer. */}
          <filter
            id="tour-spotlight-blur"
            filterUnits="userSpaceOnUse"
            x="-10000"
            y="-10000"
            width="20000"
            height="20000"
          >
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <g filter="url(#tour-spotlight-blur)">
              {targetRects.map((r, i) => (
                <rect
                  key={i}
                  x={r.left - spotlightPad}
                  y={r.top - spotlightPad}
                  width={r.width + spotlightPad * 2}
                  height={r.height + spotlightPad * 2}
                  rx={spotlightRadius}
                  fill="black"
                  // Match the ring + card 250ms transition so the spotlight
                  // cutout slides between targets together with everything
                  // else, instead of snapping while the ring smoothly slides.
                  style={{ transition: 'x 250ms ease-out, y 250ms ease-out, width 250ms ease-out, height 250ms ease-out' }}
                />
              ))}
            </g>
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.5)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* Dim layer outside the spotlight. stopPropagation so Radix Sheet's
          DismissableLayer (listening on document) doesn't see card-area clicks
          as outside-clicks and dismiss the sheet between steps. */}
      <div
        className="absolute inset-0"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />


      {/* While warming up the demo data, show a centered loading card
          instead of the regular tutorial card. The dim overlay above is
          already in place, so the page underneath is hidden — even if it's
          still mid-skeleton. Spinner clears as soon as the sentinel target
          appears (or the 6s safety timeout fires). */}
      {warming && (
        <div
          ref={cardRef}
          className="absolute w-[260px] rounded-xl border bg-background shadow-xl p-5 flex flex-col items-center gap-3"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10050,
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleSkip}
            className="absolute top-3 right-3 p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
            aria-label="Skip tutorial"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground text-center">Setting up the tour…</p>
        </div>
      )}

      {/* Floating card — z-index must be above Sheet overlay (10015). Hidden
          while we wait for the target to mount (so it doesn't flash at the
          wrong position); after a short fallback timeout we show centered so
          the tutorial isn't stuck if the page is empty or still loading. */}
      {!warming && <div
        ref={cardRef}
        className="absolute w-[320px] max-w-[calc(100vw-24px)] rounded-xl border bg-background shadow-xl p-4 space-y-3"
        style={{
          ...cardStyle,
          zIndex: 10050,
          opacity: readyToShow ? 1 : 0,
          pointerEvents: readyToShow ? 'auto' : 'none',
          // Aligned with the ring + SVG cutout transitions so the whole
          // spotlight + card moves together as one smooth unit between steps.
          transition: 'top 250ms ease-out, left 250ms ease-out, opacity 200ms ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleSkip}
          className="absolute top-3 right-3 p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Welcome icon for centered step */}
        {isCenter && step === 0 && (
          <div className="flex justify-center pb-1">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
          </div>
        )}

        <div className={isCenter && step === 0 ? 'text-center' : ''}>
          <h3 className="text-base font-semibold pr-6">{currentStep.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {(isMobile && currentStep.mobileDescription) || currentStep.description}
          </p>
        </div>

        {currentStep.docPath && (
          <button
            onClick={() => openDocLink(currentStep.docPath!)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            Learn more
            <ExternalLink className="h-3 w-3" />
          </button>
        )}

        {/* Footer: dots + navigation */}
        <div className="flex flex-wrap items-center justify-between gap-y-2 pt-1 border-t">
          {/* Step dots */}
          <div className="flex gap-1.5 shrink-0">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === step ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {step === 0 && (
              <Button variant="ghost" size="sm" onClick={handleSkip} className="h-8 px-2 text-xs text-muted-foreground">
                Skip
              </Button>
            )}
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={handleBack} className="h-8 px-2">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <Button size="sm" onClick={handleNext} className="h-8">
              {step === STEPS.length - 1 ? 'Done' : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>}
    </div>,
    document.body
  );
}
