// Docks the request log beneath the app, squashing it rather than covering it.
//
// The squash is the fiddly part. The dashboard positions much of itself
// `fixed`, which resolves against the viewport and would happily sit behind the
// dock — so the wrapper sets `transform: translateZ(0)`, which makes it a
// containing block for fixed descendants. They then resolve against the
// wrapper, and giving the wrapper the remaining height genuinely shrinks the
// app into it.
//
// That transform is applied ONLY while the dock is open. It creates a stacking
// context, and this app leans on backdrop-blur and z-index in ways that are not
// worth perturbing for everyone to serve a developer tool nobody else can see.

import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import { isRequestPanelEnabled, subscribeRequestPanelEnabled } from '@/lib/request-log';
import { useNativeHeaderActive } from '@/hooks/useNativeHeader';
import { useLocation } from 'react-router-dom';
import { isMarketingPath } from '@/lib/marketing-routes';
import { checkIsInMacApp, checkIsInMobileApp } from '@/lib/platform';

// Lazy so the panel's markup never lands in the entry chunk for the people who
// will never open it.
const RequestLogPanel = lazy(() => import('./RequestLogPanel'));

export function DebugDock({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => isRequestPanelEnabled());

  useEffect(() => subscribeRequestPanelEnabled(() => setOpen(isRequestPanelEnabled())), []);

  // The squash below puts the whole app inside a fixed, overflow-hidden box,
  // which only works where the app scrolls an inner container of its own —
  // the Mac and mobile shells without the native header (Dashboard's
  // `shellScrolls`). Everywhere else the DOCUMENT scrolls, and boxed in it had
  // nothing to scroll: a phone under the iOS native header (UIKit reads the
  // web view's own offset to collapse the large title) could not scroll the
  // dashboard at all (2026-09-14), and nor could a desktop browser, wheel or
  // otherwise (2026-09-29). There the log simply overlays the bottom, and the
  // page pads itself by the dock's height instead (`useDebugDockHeight`).
  const nativeHeader = useNativeHeaderActive();
  const shellScrolls = (checkIsInMacApp() || checkIsInMobileApp()) && !nativeHeader;

  // The website is not the app: a developer with the log switched on should
  // still see the landing page as a visitor does. `mqtt.` serves the MQTT
  // browser at `/`, which is the app, so it keeps the log.
  const { pathname } = useLocation();
  const onWebsite = isMarketingPath(pathname) && !location.hostname.includes('mqtt.');

  if (!open || onWebsite) return <>{children}</>;

  const panel = (
    <Suspense fallback={null}>
      <RequestLogPanel />
    </Suspense>
  );

  // Not merely `children`: until 2026-09-29 this branch dropped the panel as
  // well as the box, so under the native header the log was not overlaid, it
  // was gone.
  if (!shellScrolls) {
    return (
      <>
        {children}
        <div className="fixed inset-x-0 bottom-0 z-[10000] flex flex-col">{panel}</div>
      </>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col">
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        // See the note above: this is what makes `fixed` children obey the dock.
        style={{ transform: 'translateZ(0)' }}
      >
        {children}
      </div>
      {panel}
    </div>
  );
}
