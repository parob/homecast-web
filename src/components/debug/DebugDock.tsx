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

// Lazy so the panel's markup never lands in the entry chunk for the people who
// will never open it.
const RequestLogPanel = lazy(() => import('./RequestLogPanel'));

export function DebugDock({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => isRequestPanelEnabled());

  useEffect(() => subscribeRequestPanelEnabled(() => setOpen(isRequestPanelEnabled())), []);

  // Under the iOS native header the DOCUMENT scrolls — UIKit reads the web
  // view's own scroll offset to collapse the large title, and an inner scroller
  // is invisible to it. The squash below puts the whole app inside a fixed,
  // overflow-hidden box, which left the document with nothing to scroll: a
  // phone with the request log switched on could not scroll the dashboard at
  // all (2026-09-14). So there the log simply overlays the bottom, and the
  // page pads itself by the dock's height instead (`useDebugDockHeight`).
  const nativeHeader = useNativeHeaderActive();

  if (!open || nativeHeader) return <>{children}</>;

  return (
    <div className="fixed inset-0 flex flex-col">
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        // See the note above: this is what makes `fixed` children obey the dock.
        style={{ transform: 'translateZ(0)' }}
      >
        {children}
      </div>
      <Suspense fallback={null}>
        <RequestLogPanel />
      </Suspense>
    </div>
  );
}
