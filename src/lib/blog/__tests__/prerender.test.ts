import { describe, it, expect } from 'vitest';
import { parsePost } from '../parse';
import { renderRss, renderSitemap, withPageHead, withRootContent, renderPostPage } from '../prerender';

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
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1];
    expect(ld).not.toContain('<');
    expect(JSON.parse(ld)).toMatchObject({ '@type': 'BlogPosting', datePublished: '2026-10-05' });
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
  it('carries the title, standfirst, date and body', () => {
    const html = renderPostPage(POST, '<p>Body</p>', { width: 1600, height: 900 });
    expect(html).toContain('<h1');
    expect(html).toContain('Leave &quot;now&quot; &amp; &lt;run&gt;');
    expect(html).toContain('<time datetime="2026-10-05">5 October 2026</time>');
    expect(html).toContain('width="1600" height="900"');
    expect(html).toContain('<p>Body</p>');
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
