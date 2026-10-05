/**
 * Static HTML for the blog, written into dist/ at build time.
 *
 * The app is client-rendered: every URL is answered with the same index.html,
 * titled "Homecast", with an empty #root. That is fine for the product and
 * useless for an article — a search engine or a link-preview bot sees the
 * generic card and none of the words. So for each post the build writes a real
 * document: the article's own title, description and Open Graph tags in the
 * head, and the article itself in #root. Firebase serves a file that exists
 * before it applies the SPA rewrite, so these are what /blog/<slug>/ returns.
 *
 * Post URLs end in a slash, and that is the canonical form everywhere —
 * links, canonical tags, the sitemap, the feed. Firebase answers a directory's
 * index.html only at the slashed URL and 301s the bare one to it, so a bare
 * canonical would send every crawler through a redirect.
 *
 * When the bundle loads, React's createRoot replaces #root with the same post
 * rendered by BlogPost.tsx. The markup here borrows that page's classes (see
 * BLOG_CLASSES) so the swap is close to invisible — but it is not hydration,
 * and nothing depends on the two matching exactly.
 *
 * Pure string work, no `fs`, so vite.config.ts and the tests share it.
 */
import {
  categoryLabel, escapeHtml, formatPostDate,
  type BlogPost, type BlogPostMeta,
} from './parse';

export const SITE_ORIGIN = 'https://homecast.cloud';
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;

/** Shared with Blog.tsx / BlogPost.tsx, so the static and live pages agree. */
export const BLOG_CLASSES = {
  page: 'min-h-screen bg-background',
  main: 'pt-16',
  articleSection: 'w-full px-6 pt-10 pb-16 sm:pt-14',
  articleColumn: 'mx-auto max-w-3xl',
  kicker: 'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground mb-4',
  categoryPill: 'rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium',
  title: 'text-3xl sm:text-5xl font-bold tracking-tight leading-tight mb-4',
  standfirst: 'text-lg sm:text-xl text-muted-foreground leading-relaxed mb-6',
  byline: 'text-sm text-muted-foreground mb-8',
  cover: 'w-full rounded-2xl border border-border mb-10 aspect-[16/9] object-cover bg-muted',
  body: 'blog-body',
} as const;

export interface PageMeta {
  title: string;
  description: string;
  /** Path on homecast.cloud, e.g. /blog/local-mode */
  path: string;
  image?: string;
  imageAlt?: string;
  type: 'website' | 'article';
  publishedTime?: string;
  author?: string;
}

const absolute = (src: string) => (src.startsWith('http') ? src : `${SITE_ORIGIN}${src}`);

/**
 * Rewrites the built index.html's head for one page: title, description,
 * canonical URL, Open Graph and Twitter tags, the feed link, and (for a post)
 * JSON-LD. Tags the template already has are replaced in place; the rest are
 * added before </head>.
 */
export function withPageHead(template: string, meta: PageMeta): string {
  const url = `${SITE_ORIGIN}${meta.path}`;
  const image = meta.image ? absolute(meta.image) : DEFAULT_OG_IMAGE;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);

  const setMeta = (html: string, attr: 'name' | 'property', key: string, value: string) => {
    const tag = `<meta ${attr}="${key}" content="${value}" />`;
    const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
    return re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => `    ${tag}\n  </head>`);
  };

  let html = template.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:type', meta.type);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:image', escapeHtml(image));
  html = setMeta(html, 'property', 'og:site_name', 'Homecast');
  html = setMeta(html, 'name', 'twitter:image', escapeHtml(image));
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', description);
  if (meta.imageAlt) {
    html = setMeta(html, 'property', 'og:image:alt', escapeHtml(meta.imageAlt));
    html = setMeta(html, 'name', 'twitter:image:alt', escapeHtml(meta.imageAlt));
  }
  if (meta.publishedTime) {
    html = setMeta(html, 'property', 'article:published_time', meta.publishedTime);
  }

  const extra = [
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" type="application/rss+xml" title="Homecast Blog" href="${SITE_ORIGIN}/blog/feed.xml" />`,
  ];
  if (meta.type === 'article') {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: meta.title,
      description: meta.description,
      datePublished: meta.publishedTime,
      image,
      url,
      author: meta.author ? { '@type': 'Person', name: meta.author } : undefined,
      publisher: { '@type': 'Organization', name: 'Homecast', url: SITE_ORIGIN },
    };
    // `<` escaped so no string in a post can close the script element.
    extra.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  }
  return html.replace('</head>', () => `    ${extra.join('\n    ')}\n  </head>`);
}

/**
 * Swaps #root's contents — the boot splash — for the page. The splash is a
 * fixed black overlay, so leaving it in would hide the article from anyone
 * without JavaScript; nothing else depends on it (the boot watchdog in
 * index.html keys off window.__homecastBooted, not the markup).
 */
export function withRootContent(template: string, content: string): string {
  const re = /<div id="root">[\s\S]*?<\/div>(\s*)(?=<script|<\/body>)/;
  if (!re.test(template)) throw new Error('index.html has no recognisable <div id="root"> to fill');
  return template.replace(re, (_m, ws: string) => `<div id="root">${content}</div>${ws}`);
}

const staticHeader = `<nav class="border-b border-border"><div class="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">`
  + `<a href="/" class="text-xl font-bold tracking-tight">Homecast</a>`
  + `<a href="/how-it-works" class="text-sm text-muted-foreground">How it Works</a>`
  + `<a href="/pricing" class="text-sm text-muted-foreground">Pricing</a>`
  + `<a href="/blog/" class="text-sm text-muted-foreground">Blog</a>`
  + `<a href="https://docs.homecast.cloud" class="text-sm text-muted-foreground">Docs</a>`
  + `</div></nav>`;

/** The article as static markup, for #root. */
export function renderPostPage(post: BlogPost, bodyHtml: string, coverSize?: { width: number; height: number }): string {
  const c = BLOG_CLASSES;
  const dims = coverSize ? ` width="${coverSize.width}" height="${coverSize.height}"` : '';
  const cover = post.cover
    ? `<img src="${escapeHtml(post.cover)}" alt="${escapeHtml(post.coverAlt ?? '')}"${dims} class="${c.cover}">`
    : '';
  return `<div class="${c.page}">${staticHeader}<main><article class="${c.articleSection}"><div class="${c.articleColumn}">`
    + `<p class="${c.kicker}"><a href="/blog/">Blog</a> · <span class="${c.categoryPill}">${categoryLabel(post.category)}</span>`
    + ` <time datetime="${post.date}">${formatPostDate(post.date)}</time> · ${post.readingMinutes} min read</p>`
    + `<h1 class="${c.title}">${escapeHtml(post.title)}</h1>`
    + `<p class="${c.standfirst}">${escapeHtml(post.description)}</p>`
    + `<p class="${c.byline}">By ${escapeHtml(post.author)}</p>`
    + cover
    + `<div class="${c.body}">${bodyHtml}</div>`
    + `</div></article></main></div>`;
}

/** The index as static markup, for #root: every post, as a plain list of links. */
export function renderIndexPage(posts: readonly BlogPostMeta[]): string {
  const c = BLOG_CLASSES;
  const items = posts.map((p) =>
    `<li class="mb-8"><p class="text-sm text-muted-foreground">${categoryLabel(p.category)} · <time datetime="${p.date}">${formatPostDate(p.date)}</time></p>`
    + `<h2 class="text-xl font-semibold"><a href="${postPath(p.slug)}">${escapeHtml(p.title)}</a></h2>`
    + `<p class="text-muted-foreground">${escapeHtml(p.description)}</p></li>`).join('');
  return `<div class="${c.page}">${staticHeader}<main><section class="${c.articleSection}"><div class="${c.articleColumn}">`
    + `<h1 class="${c.title}">Blog</h1><p class="${c.standfirst}">${escapeHtml(BLOG_INTRO)}</p>`
    + `<ul>${items}</ul></div></section></main></div>`;
}

export const BLOG_INTRO =
  'News from Homecast, guides to real setups, and notes on running an Apple Home that talks to everything else.';

export const BLOG_INDEX_META: Omit<PageMeta, 'path'> = {
  title: 'Blog — Homecast',
  description: BLOG_INTRO,
  type: 'website',
};

/** A post's canonical path: /blog/<slug>/ (see the note at the top). */
export const postPath = (slug: string) => `/blog/${slug}/`;

export const postPageTitle = (post: BlogPostMeta) => `${post.title} — Homecast`;

/** sitemap.xml for the website: the marketing pages, the blog, and every post. */
export function renderSitemap(paths: readonly string[], posts: readonly BlogPostMeta[]): string {
  const urls = [
    ...paths.map((p) => `  <url><loc>${SITE_ORIGIN}${p}</loc></url>`),
    ...posts.map((p) => `  <url><loc>${SITE_ORIGIN}${postPath(p.slug)}</loc><lastmod>${p.date}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** RSS 2.0, newest first, summaries only — the feed points at the site. */
export function renderRss(posts: readonly BlogPostMeta[]): string {
  const items = posts.map((p) => [
    '    <item>',
    `      <title>${escapeHtml(p.title)}</title>`,
    `      <link>${SITE_ORIGIN}${postPath(p.slug)}</link>`,
    `      <guid isPermaLink="true">${SITE_ORIGIN}${postPath(p.slug)}</guid>`,
    `      <pubDate>${new Date(`${p.date}T09:00:00Z`).toUTCString()}</pubDate>`,
    `      <category>${categoryLabel(p.category)}</category>`,
    `      <description>${escapeHtml(p.description)}</description>`,
    '    </item>',
  ].join('\n'));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>Homecast Blog</title>',
    `    <link>${SITE_ORIGIN}/blog/</link>`,
    `    <atom:link href="${SITE_ORIGIN}/blog/feed.xml" rel="self" type="application/rss+xml" />`,
    `    <description>${escapeHtml(BLOG_INTRO)}</description>`,
    '    <language>en-gb</language>',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
