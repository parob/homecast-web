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

// Lazy so the panel's markup never lands in the entry chunk for the people who
// will never open it.
const RequestLogPanel = lazy(() => import('./RequestLogPanel'));

export function DebugDock({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => isRequestPanelEnabled());

  useEffect(() => subscribeRequestPanelEnabled(() => setOpen(isRequestPanelEnabled())), []);

  if (!open) return <>{children}</>;

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
