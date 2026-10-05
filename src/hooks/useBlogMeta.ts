import { useEffect } from 'react';
import { DEFAULT_PAGE_META, pageHeadEntries, type PageMeta } from '@/lib/blog/seo';

export function applyBlogMeta(meta: PageMeta) {
  document.title = meta.title;
  for (const entry of pageHeadEntries(meta)) {
    const selector = entry.tag + Object.entries(entry.match).map(([key, value]) => `[${key}="${value}"]`).join('');
    const matches = [...document.head.querySelectorAll(selector)];
    const element = matches.shift() ?? document.createElement(entry.tag);
    matches.forEach((duplicate) => duplicate.remove());
    if (!entry.attrs) {
      element.remove();
      continue;
    }
    for (const [key, value] of Object.entries({ ...entry.match, ...entry.attrs })) element.setAttribute(key, value);
    if (entry.text !== undefined) element.textContent = entry.text;
    if (!element.isConnected) document.head.append(element);
  }
}

/** Keep the head in sync on post → post → index → app navigation. */
export function useBlogMeta(meta: PageMeta) {
  // Callers can create the small metadata object inline without rerunning the
  // effect on unrelated page state (filters, comments, theme, etc.).
  const serialized = JSON.stringify(meta);
  useEffect(() => {
    applyBlogMeta(JSON.parse(serialized) as PageMeta);
    // Restoring the original DOM would restore the first prerendered article
    // on every later page. Clear article metadata when leaving instead.
    return () => applyBlogMeta(DEFAULT_PAGE_META);
  }, [serialized]);
}
