import { describe, it, expect } from 'vitest';
import { parsePost } from '../parse';
import { renderRss, renderSitemap, withPageHead, withRootContent, renderPostPage, renderPostRedirect, renderIndexPage, postPageMeta, BLOG_INDEX_META } from '../prerender';

// The shape Vite emits: head tags from index.html, the splash inside #root.
const TEMPLATE = `<!doctype html><html><head>
    <title>Homecast</title>
    <meta name="description" content="Generic" />
    <meta property="og:title" content="Homecast" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="https://homecast.cloud/og-image.png" />
    <meta name="twitter:image" content="https://homecast.cloud/og-image.png" />
  </head>
  <body style="margin:0">
    <div id="root"><div id="app-loader" style="position:fixed"><img src="/icon-192.png" /><div></div><style>x</style></div></div>
  </body></html>`;

const POST = parsePost('train-light', `---
title: Leave "now" & <run>
description: A light that says when to go.
date: 2026-10-05
category: guide
author: Rob Parker
cover: /blog/train-light/cover.webp
coverAlt: A hall lamp
---
Hello.`);

describe('withPageHead', () => {
  const html = withPageHead(TEMPLATE, {
    title: POST.title, description: POST.description, path: '/blog/train-light/',
    image: POST.cover, type: 'article', publishedTime: POST.date, author: POST.author,
  });

  it('replaces the generic tags instead of adding duplicates', () => {
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).not.toContain('content="Generic"');
  });

  it('escapes the title wherever it lands', () => {
    expect(html).toContain('<title>Leave &quot;now&quot; &amp; &lt;run&gt;</title>');
    expect(html).not.toContain('<run>');
  });

  it('points canonical, og:url and og:image at absolute URLs', () => {
    expect(html).toContain('<link rel="canonical" href="https://homecast.cloud/blog/train-light/" />');
    expect(html).toContain('<meta property="og:url" content="https://homecast.cloud/blog/train-light/" />');
    expect(html).toContain('<meta property="og:image" content="https://homecast.cloud/blog/train-light/cover.webp" />');
  });

  it('adds JSON-LD that cannot close its own script tag', () => {
    const ld = html.match(/<script id="blog-structured-data" type="application\/ld\+json">(.*?)<\/script>/)![1];
    expect(ld).not.toContain('<');
    expect(JSON.parse(ld)['@graph'][0]).toMatchObject({ '@type': 'BlogPosting', datePublished: '2026-10-05' });
  });

  it('can replace an article head with the index without duplicates or stale tags', () => {
    const article = withPageHead(TEMPLATE, postPageMeta(POST));
    const twice = withPageHead(article, postPageMeta(POST));
    expect(twice.match(/rel="canonical"/g)).toHaveLength(1);
    expect(twice.match(/id="blog-structured-data"/g)).toHaveLength(1);
    const index = withPageHead(twice, BLOG_INDEX_META);
    expect(index).not.toContain('article:published_time');
    expect(index).not.toContain('blog-structured-data');
    expect(index).not.toContain('og:image:alt');
    expect(index.match(/application\/rss\+xml/g)).toHaveLength(1);
    expect(index).toContain('rel="canonical" href="https://homecast.cloud/blog/"');
  });
});

describe('withRootContent', () => {
  it('replaces the whole splash, nested markup included', () => {
    const html = withRootContent(TEMPLATE, '<article>Hi</article>');
    expect(html).toContain('<div id="root"><article>Hi</article></div>');
    expect(html).not.toContain('app-loader');
    expect(html).toContain('</body>');
  });

  it('fails loudly if index.html changes shape', () => {
    expect(() => withRootContent('<html></html>', 'x')).toThrow(/root/);
  });
});

describe('renderPostPage', () => {
  it('carries the title, author, date and body', () => {
    const html = renderPostPage(POST, '<p>Body</p>');
    expect(html).toContain('<h1');
    expect(html).toContain('Leave &quot;now&quot; &amp; &lt;run&gt;');
    expect(html).toContain('<time datetime="2026-10-05">5 October 2026</time>');
    expect(html).not.toContain('<img');
    expect(html).toContain('By Rob Parker');
    expect(html).not.toContain(POST.description);
    expect(html).toContain('<p>Body</p>');
  });

  it('includes related links for readers and crawlers without JavaScript', () => {
    const other = { ...POST, slug: 'another-post', title: 'Another post' };
    const html = renderPostPage(POST, '<p>Body</p>', [POST, other]);
    expect(html).toContain('More from the blog');
    expect(html).toContain('href="/blog/another-post/"');
    expect(html).not.toContain('href="/blog/train-light/"');
  });
});

describe('feeds', () => {
  it('lists every post in the sitemap and the RSS feed', () => {
    expect(renderSitemap(['/', '/blog/'], [POST])).toContain('<loc>https://homecast.cloud/blog/train-light/</loc><lastmod>2026-10-05</lastmod>');
    const rss = renderRss([POST]);
    expect(rss).toContain('<guid isPermaLink="true">https://homecast.cloud/blog/train-light/</guid>');
    expect(rss).toContain('<title>Leave &quot;now&quot; &amp; &lt;run&gt;</title>');
  });
});

describe('featured launch', () => {
  it('leads the static index without changing the feed order', () => {
    const launch = { ...POST, slug: 'introducing-homecast', title: 'Introducing Homecast', featured: true };
    const posts = [POST, launch];
    const index = renderIndexPage(posts);
    expect(index.indexOf('/blog/introducing-homecast/')).toBeLessThan(index.indexOf('/blog/train-light/'));
    const feed = renderRss(posts);
    expect(feed.indexOf('/blog/train-light/')).toBeLessThan(feed.indexOf('/blog/introducing-homecast/'));
  });
});

describe('merged posts', () => {
  it('redirects the static page and canonical URL to the surviving post', () => {
    const html = renderPostRedirect('your-home-shouldnt-care-which-phone-you-own');
    expect(html).toContain('content="0;url=/blog/your-home-shouldnt-care-which-phone-you-own/"');
    expect(html).toContain('rel="canonical" href="https://homecast.cloud/blog/your-home-shouldnt-care-which-phone-you-own/"');
    expect(html).toContain('<a href="/blog/your-home-shouldnt-care-which-phone-you-own/">');
  });
});
