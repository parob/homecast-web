import { useEffect } from 'react';

/**
 * Sets the tab title and description while a page is mounted, and puts back
 * whatever was there when it unmounts.
 *
 * Only for navigation inside the app — a crawler or a link-preview bot never
 * runs this. What they see comes from the prerendered HTML (see
 * lib/blog/prerender.ts); this keeps the tab and the browser history honest
 * once the bundle has taken over.
 */
export function useDocumentMeta(title: string, description?: string) {
  useEffect(() => {
    const previousTitle = document.title;
    const tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = tag?.content;

    document.title = title;
    if (tag && description) tag.content = description;

    return () => {
      document.title = previousTitle;
      if (tag && previousDescription !== undefined) tag.content = previousDescription;
    };
  }, [title, description]);
}
