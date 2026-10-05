import type { BlogPostMeta } from './parse';

export const SITE_ORIGIN = 'https://homecast.cloud';
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;
export const postPath = (slug: string) => `/blog/${slug}/`;
export const postPageTitle = (post: BlogPostMeta) => `${post.title} — Homecast`;

export interface PageMeta {
  title: string;
  description: string;
  path?: string;
  image?: string;
  imageAlt?: string;
  type: 'website' | 'article';
  headline?: string;
  publishedTime?: string;
  author?: string;
  noindex?: boolean;
}

/** Also used when leaving the blog, so a prerendered article cannot linger. */
export const DEFAULT_PAGE_META: PageMeta = {
  title: 'Homecast',
  description: 'Give Android, Windows, and web users access to your Apple HomeKit smart home',
  type: 'website',
};

export const BLOG_INDEX_META: PageMeta = {
  title: 'Apple Home tutorials and news — Homecast Blog',
  description: 'Apple Home on Android, Home Assistant, automations and more. Tutorials and updates from Homecast.',
  path: '/blog/',
  type: 'website',
};

export const postPageMeta = (post: BlogPostMeta): PageMeta => ({
  title: postPageTitle(post),
  headline: post.title,
  description: post.description,
  path: postPath(post.slug),
  image: post.cover,
  imageAlt: post.coverAlt,
  type: 'article',
  publishedTime: post.date,
  author: post.author,
});

export interface HeadEntry {
  tag: 'meta' | 'link' | 'script';
  /** These attributes identify the one tag to update or remove. */
  match: Record<string, string>;
  attrs?: Record<string, string>;
  text?: string;
}

const absolute = (src: string) => new URL(src, SITE_ORIGIN).href;

/** One definition for the static HTML and navigation inside the React app. */
export function pageHeadEntries(meta: PageMeta): HeadEntry[] {
  const url = meta.path ? absolute(meta.path) : undefined;
  const image = meta.image ? absolute(meta.image) : DEFAULT_OG_IMAGE;
  const metaTag = (attr: 'name' | 'property', key: string, value?: string): HeadEntry => ({
    tag: 'meta', match: { [attr]: key }, attrs: value === undefined ? undefined : { content: value },
  });
  const entries: HeadEntry[] = [
    metaTag('name', 'description', meta.description),
    metaTag('name', 'author', meta.author ?? 'Homecast'),
    metaTag('name', 'robots', meta.noindex ? 'noindex, follow' : url ? 'max-image-preview:large' : undefined),
    metaTag('property', 'og:title', meta.title),
    metaTag('property', 'og:description', meta.description),
    metaTag('property', 'og:type', meta.type),
    metaTag('property', 'og:url', url),
    metaTag('property', 'og:image', image),
    metaTag('property', 'og:image:alt', meta.imageAlt),
    metaTag('property', 'og:site_name', 'Homecast'),
    metaTag('property', 'og:locale', 'en_GB'),
    metaTag('name', 'twitter:card', 'summary_large_image'),
    metaTag('name', 'twitter:title', meta.title),
    metaTag('name', 'twitter:description', meta.description),
    metaTag('name', 'twitter:image', image),
    metaTag('name', 'twitter:image:alt', meta.imageAlt),
    metaTag('property', 'article:published_time', meta.type === 'article' ? meta.publishedTime : undefined),
    { tag: 'link', match: { rel: 'canonical' }, attrs: url ? { href: url } : undefined },
    {
      tag: 'link', match: { rel: 'alternate', type: 'application/rss+xml' },
      attrs: { title: 'Homecast Blog', href: `${SITE_ORIGIN}/blog/feed.xml` },
    },
  ];
  const structuredData = meta.type === 'article' && url && !meta.noindex ? {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: meta.headline ?? meta.title,
        description: meta.description,
        datePublished: meta.publishedTime,
        image: meta.image ? image : undefined,
        url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        inLanguage: 'en-GB',
        author: meta.author ? { '@type': 'Person', name: meta.author } : undefined,
        publisher: { '@type': 'Organization', name: 'Homecast', url: SITE_ORIGIN },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Homecast', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_ORIGIN}/blog/` },
          { '@type': 'ListItem', position: 3, name: meta.headline ?? meta.title, item: url },
        ],
      },
    ],
  } : undefined;
  entries.push({
    tag: 'script', match: { id: 'blog-structured-data' },
    attrs: structuredData ? { type: 'application/ld+json' } : undefined,
    text: structuredData ? JSON.stringify(structuredData).replace(/</g, '\\u003c') : undefined,
  });
  return entries;
}
