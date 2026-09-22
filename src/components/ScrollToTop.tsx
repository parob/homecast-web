import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { viewKeyOf } from '@/lib/view-key';

export function ScrollToTop() {
  const { pathname, search } = useLocation();
  // Not `pathname` alone. The dashboard navigates by search param and stays on
  // `/portal`, so keying on the pathname missed every move inside the app —
  // a room opened from a scrolled home kept the home's offset and came in with
  // its title clipped off the top (parob/homecast-cloud#175).
  const viewKey = viewKeyOf(pathname, search);

  useEffect(() => {
    // `behavior: 'instant'`, and not by omission. `scroll-behavior: smooth` is
    // set on `html` in index.css, and a two-argument `scrollTo` inherits it —
    // so this reset was being *animated*, gliding to the top over ~300ms while
    // the new view was already painting under it.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });

    // The native shell scrolls an inner container instead of the document
    // (`shellScrolls` in Dashboard.tsx), where `window.scrollTo` is a no-op.
    // Those containers carry `data-app-scroller`.
    document.querySelectorAll<HTMLElement>('[data-app-scroller]').forEach((el) => {
      el.scrollTop = 0;
    });
  }, [viewKey]);

  return null;
}
