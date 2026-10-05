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
  categoryLabel, escapeHtml, formatPostDate, relatedPosts, sortIndexPosts,
  type BlogPost, type BlogPostMeta,
} from './parse';

import { pageHeadEntries, postPath, SITE_ORIGIN, type PageMeta } from './seo';
export { BLOG_INDEX_META, DEFAULT_OG_IMAGE, postPageMeta, postPageTitle, postPath, SITE_ORIGIN, type PageMeta } from './seo';

/** Shared with Blog.tsx / BlogPost.tsx, so the static and live pages agree. */
export const BLOG_CLASSES = {
  page: 'min-h-screen bg-background',
  main: 'pt-16',
  articleSection: 'w-full px-5 sm:px-6 pt-7 pb-12 sm:pt-10',
  articleColumn: 'mx-auto max-w-2xl',
  kicker: 'flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mb-2',
  title: 'text-[1.75rem] sm:text-4xl font-semibold tracking-tight leading-[1.2] mb-4',
  standfirst: 'text-base text-muted-foreground leading-relaxed mb-5',
  byline: 'text-xs text-muted-foreground mb-6',
  body: 'blog-body',
  postList: 'divide-y divide-border border-y border-border',
  postLink: 'group grid items-start gap-x-4 sm:gap-x-6 py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4',
  postWithImage: 'grid-cols-[minmax(0,1fr)_4rem] sm:grid-cols-[minmax(0,1fr)_7rem]',
  postMeta: 'col-span-full mb-1.5 sm:col-span-1',
  postThumbnail: 'col-start-2 row-start-2 h-16 w-16 rounded-sm object-cover sm:row-start-1 sm:row-span-3 sm:h-20 sm:w-28',
  postTitle: 'col-start-1 text-lg sm:text-xl font-semibold leading-snug tracking-tight mb-1.5 group-hover:text-primary transition-colors',
  postDescription: 'col-span-full sm:col-span-1 sm:col-start-1 text-sm text-muted-foreground leading-relaxed',
} as const;

/** Replaces owned tags, preserving unrelated head content. Safe to run twice. */
export function withPageHead(template: string, meta: PageMeta): string {
  let html = template.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(meta.title)}</title>`);
  for (const entry of pageHeadEntries(meta)) {
    const conditions = Object.entries(entry.match)
      .map(([key, value]) => `(?=[^>]*\\b${key}=["']${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'])`)
      .join('');
    const pattern = new RegExp(`<${entry.tag}\\b${conditions}[^>]*>${entry.tag === 'script' ? '[\\s\\S]*?<\\/script>' : ''}`, 'g');
    html = html.replace(pattern, '');
    if (!entry.attrs) continue;
    const attrs = Object.entries({ ...entry.match, ...entry.attrs })
      .map(([key, value]) => `${key}="${escapeHtml(value)}"`).join(' ');
    const tag = entry.tag === 'script'
      ? `<script ${attrs}>${entry.text ?? ''}</script>`
      : `<${entry.tag} ${attrs} />`;
    html = html.replace('</head>', () => `    ${tag}\n  </head>`);
  }
  return html;
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

const staticHeader = `<nav class="border-b border-border"><div class="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">`
  + `<a href="/" class="text-xl font-bold tracking-tight">Homecast</a>`
  + `<a href="/how-it-works" class="text-sm text-muted-foreground">How it Works</a>`
  + `<a href="/pricing" class="text-sm text-muted-foreground">Pricing</a>`
  + `<a href="/blog/" class="text-sm text-muted-foreground">Blog</a>`
  + `<a href="https://docs.homecast.cloud" class="text-sm text-muted-foreground">Docs</a>`
  + `</div></nav>`;

/** The article as static markup, for #root. */
export function renderPostPage(post: BlogPost, bodyHtml: string, posts: readonly BlogPostMeta[] = []): string {
  const c = BLOG_CLASSES;
  const related = relatedPosts(post, posts);
  const more = related.length ? `<section class="w-full px-6 pb-16"><div class="${c.articleColumn}"><h2 class="text-lg font-semibold tracking-tight mb-4">More from the blog</h2><ul class="${c.postList}">${renderPostLinks(related)}</ul></div></section>` : '';
  return `<div class="${c.page}">${staticHeader}<main><article class="${c.articleSection}"><div class="${c.articleColumn}">`
    + `<a href="/blog/" class="inline-flex text-sm text-muted-foreground mb-6">← Blog</a>`
    + `<h1 class="${c.title}">${escapeHtml(post.title)}</h1>`
    + `<p class="${c.kicker}"><span>${categoryLabel(post.category)}</span> ·`
    + ` <time datetime="${post.date}">${formatPostDate(post.date)}</time> · ${post.readingMinutes} min read</p>`
    + `<p class="${c.byline}">By ${escapeHtml(post.author)}</p>`
    + `<div class="${c.body}">${bodyHtml}</div>`
    + `</div></article>${more}</main></div>`;
}

/** The index as static markup, for #root: every post, as a plain list of links. */
function renderPostLinks(posts: readonly BlogPostMeta[]): string {
  const c = BLOG_CLASSES;
  return posts.map((p) =>
    `<li><a href="${postPath(p.slug)}" class="${c.postLink}${p.cover ? ` ${c.postWithImage}` : ''}">`
    + `<p class="${c.postMeta} text-xs text-muted-foreground">${categoryLabel(p.category)} · <time datetime="${p.date}">${formatPostDate(p.date)}</time> · ${p.readingMinutes} min read</p>`
    + `<h2 class="${c.postTitle}">${escapeHtml(p.title)}</h2>`
    + `<p class="${c.postDescription}">${escapeHtml(p.description)}</p>`
    + (p.cover ? `<img src="${escapeHtml(p.cover)}" alt="" width="144" height="96" loading="lazy" decoding="async" class="${c.postThumbnail}" />` : '')
    + `</a></li>`).join('');
}

export function renderIndexPage(posts: readonly BlogPostMeta[]): string {
  const c = BLOG_CLASSES;
  const items = renderPostLinks(sortIndexPosts(posts));
  return `<div class="${c.page}">${staticHeader}<main><section class="${c.articleSection}"><div class="${c.articleColumn}">`
    + `<h1 class="${c.title}">Blog</h1><p class="${c.standfirst}">${escapeHtml(BLOG_INTRO)}</p>`
    + `<ul class="${c.postList}">${items}</ul></div></section></main></div>`;
}

export const BLOG_INTRO =
  'Things you can do with Homecast, and notes on what’s changing.';

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

/** A static fallback keeps merged URLs useful before JavaScript loads. */
export function renderPostRedirect(slug: string): string {
  const target = escapeHtml(postPath(slug));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Post moved — Homecast</title><link rel="canonical" href="${SITE_ORIGIN}${target}"><meta http-equiv="refresh" content="0;url=${target}"></head><body><p>This post is now part of <a href="${target}">the updated post</a>.</p></body></html>`;
}
