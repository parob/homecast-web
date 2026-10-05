import { useEffect, useRef, useState } from 'react';
import { BLOG_COMMENTS, type CommentsConfig } from '@/lib/blog/comments';
import { postPath } from '@/lib/blog/seo';

function CommentThread({ slug, config }: { slug: string; config: CommentsConfig }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    const theme = () => document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const options = {
      repo: config.repo,
      'repo-id': config.repoId,
      category: config.category,
      'category-id': config.categoryId,
      mapping: 'specific',
      // A canonical path keeps one thread across query strings, previews,
      // edited titles and URLs with or without a trailing slash.
      term: postPath(slug),
      strict: '1',
      'reactions-enabled': '0',
      'emit-metadata': '0',
      'input-position': 'top',
      theme: theme(),
      lang: 'en',
      loading: 'lazy',
    };
    for (const [key, value] of Object.entries(options)) script.setAttribute(`data-${key}`, value);
    script.onerror = () => setFailed(true);
    container.append(script);

    const observer = new MutationObserver(() => {
      container.querySelector('iframe')?.contentWindow?.postMessage(
        { giscus: { setConfig: { theme: theme() } } }, 'https://giscus.app',
      );
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      script.onerror = null;
      container.replaceChildren();
    };
  }, [slug, config]);

  return (
    <>
      <p className="text-xs text-muted-foreground mb-4">
        {failed ? 'Comments couldn’t load. ' : 'Sign in with GitHub to comment. '}
        <a href={`https://github.com/${config.repo}/discussions`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
          {failed ? 'Read or reply on GitHub' : 'View discussions'}
        </a>
      </p>
      <div ref={host} className="giscus" />
    </>
  );
}

/** Collapsed until requested; opening a post makes no Giscus request. */
export function BlogComments({ slug, config = BLOG_COMMENTS }: { slug: string; config?: CommentsConfig | null }) {
  const [opened, setOpened] = useState(false);
  if (!config) return null;
  return (
    <section aria-label="Post comments" className="mt-8 border-t border-border pt-2">
      <details onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Comments</summary>
        <div className="pt-2 pb-4">
          {opened && <CommentThread key={slug} slug={slug} config={config} />}
        </div>
      </details>
    </section>
  );
}
