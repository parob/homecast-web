import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { ExternalLink, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';
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
    // Open the sidebar (no-op on desktop) then right-click the first home so
    // its context menu appears with Share spotlit.
    target: 'sidebar-home-share-item',
    mobileTarget: 'sidebar-home-share-item',
    openTriggers: [
      { target: 'sidebar-menu', action: 'click' },
      { target: 'sidebar-home-item', action: 'contextmenu' },
    ],
    title: 'Share a home or room',
    description: 'Right-click any home or room in the sidebar to open its menu — Share is right here. Pick Admin, Control or View-only and they\'ll get an email invite.',
    mobileDescription: 'Long-press any home or room in the sidebar to open its menu, then tap Share to invite family. Pick Admin, Control or View-only and they\'ll get an email invite.',
    position: 'right',
  },
  {
    target: 'widget-area',
    title: 'Share a single device',
    description: 'Right-click any device widget and choose Share to invite someone to just that accessory.',
    mobileDescription: 'Long-press any device widget and tap Share to invite someone to just that accessory.',
    position: 'bottom',
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
    target: 'background-menu-item',
    openTrigger: 'header-menu',
    title: 'Make it yours',
    description: 'Set a background here, and visit Settings for icon styles, layout density and more. Drag widgets on the dashboard to reorder them.',
    position: 'left',
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
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TutorialDialog({ open, onOpenChange, onComplete }: TutorialDialogProps) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const isMobile = useIsMobile();
  const rafRef = useRef<number>(0);
  // Index of the next trigger to attempt for the current step.
  const triggersAttemptedRef = useRef(0);
  // Number of openTriggers we actually fired (i.e. found their element). On
  // exit we press Escape once per fired trigger to unwind any menus/sheets.
  const triggersFiredRef = useRef(0);

  const currentStep = STEPS[step];
  // On mobile, use mobileTarget if available (e.g., hamburger button instead of sidebar)
  const effectiveTarget = (isMobile && currentStep.mobileTarget) || currentStep.target;
  const isCenter = !effectiveTarget || !targetRect;

  // Measure and track the target element
  useEffect(() => {
    if (!open) return;
    // Clear last step's rect synchronously so the card doesn't render at the
    // previous spotlight position while we wait for this step's target.
    setTargetRect(null);
    if (!effectiveTarget) return;

    const triggers: OpenTriggerSpec[] = currentStep.openTriggers
      ?? (currentStep.openTrigger ? [{ target: currentStep.openTrigger }] : []);
    triggersAttemptedRef.current = 0;
    triggersFiredRef.current = 0;

    const measure = () => {
      const el = document.querySelector(`[data-tour="${effectiveTarget}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
        // Scroll into view if needed
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        setTargetRect(null);
        // Target isn't in the DOM — advance through the chain of openTriggers.
        // Skip past any whose elements aren't present (e.g. mobile-only hamburger
        // on desktop). Fire at most one per tick so each opener has a frame to
        // mount its children before we try the next one.
        while (triggersAttemptedRef.current < triggers.length) {
          const spec = triggers[triggersAttemptedRef.current];
          const trigEl = document.querySelector(`[data-tour="${spec.target}"]`) as HTMLElement | null;
          triggersAttemptedRef.current += 1;
          if (!trigEl) continue;
          triggersFiredRef.current += 1;
          if (spec.action === 'contextmenu') {
              // Radix attaches its onContextMenu listener to the asChild element,
              // which is typically a descendant of our data-tour wrapper. Events
              // bubble up, not down, so dispatching on the wrapper never reaches
              // the listener — fire on the deepest first descendant so the event
              // bubbles back up through any wrappers Radix has decorated.
              let dispatchEl: HTMLElement = trigEl;
              while (dispatchEl.firstElementChild) {
                dispatchEl = dispatchEl.firstElementChild as HTMLElement;
              }
              const r = dispatchEl.getBoundingClientRect();
              dispatchEl.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 2,
                clientX: r.left + r.width / 2,
                clientY: r.top + r.height / 2,
              }));
            } else {
              trigEl.click();
            }
            break;
          }
        }
      rafRef.current = requestAnimationFrame(measure);
    };

    const timer = setTimeout(() => {
      measure();
    }, 100);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
      // Unwind each trigger we fired by pressing Escape. Radix DropdownMenu,
      // ContextMenu, and Sheet all dismiss on Escape, so one handler covers
      // every opener type.
      const fired = triggersFiredRef.current;
      triggersFiredRef.current = 0;
      for (let i = 0; i < fired; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
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
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - spotlightPad}
                y={targetRect.top - spotlightPad}
                width={targetRect.width + spotlightPad * 2}
                height={targetRect.height + spotlightPad * 2}
                rx={spotlightRadius}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.5)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* Clickable overlay (outside spotlight) to prevent interaction */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* Spotlight ring highlight */}
      {targetRect && (
        <div
          className="absolute rounded-xl ring-2 ring-primary/60 pointer-events-none transition-all duration-300"
          style={{
            top: targetRect.top - spotlightPad,
            left: targetRect.left - spotlightPad,
            width: targetRect.width + spotlightPad * 2,
            height: targetRect.height + spotlightPad * 2,
          }}
        />
      )}

      {/* Floating card — z-index must be above Sheet overlay (10015). When a
          step targets a specific element but its rect isn't measured yet
          (because openTriggers are still mounting the menu/sheet), hide the
          card so it doesn't briefly flash centered or at the previous step's
          position. */}
      <div
        className="absolute w-[320px] max-w-[calc(100vw-24px)] rounded-xl border bg-background shadow-xl p-4 space-y-3 transition-all duration-300"
        style={{
          ...cardStyle,
          zIndex: 10050,
          opacity: effectiveTarget && !targetRect ? 0 : 1,
          pointerEvents: effectiveTarget && !targetRect ? 'none' : 'auto',
        }}
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
        <div className="flex items-center justify-between pt-1 border-t">
          {/* Step dots */}
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === step ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-1.5">
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={handleBack} className="h-8">
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
      </div>
    </div>,
    document.body
  );
}
