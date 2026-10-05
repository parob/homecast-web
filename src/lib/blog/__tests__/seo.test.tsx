// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useBlogMeta } from '@/hooks/useBlogMeta';
import { BLOG_INDEX_META, DEFAULT_OG_IMAGE, postPageMeta, type PageMeta } from '../seo';
import { parsePost } from '../parse';
import { withPageHead } from '../prerender';

const first = parsePost('first', `---
title: First post
description: The first description.
date: 2026-10-05
category: guide
author: Rob Parker
cover: /blog/first/photo.webp
coverAlt: A lamp
---
Hello.`);
const second = { ...first, slug: 'second', title: 'Second post', cover: undefined, coverAlt: undefined };
const content = (selector: string) => document.head.querySelector(selector)?.getAttribute('content');
const schema = () => JSON.parse(document.getElementById('blog-structured-data')!.textContent!);

afterEach(() => { cleanup(); document.head.innerHTML = ''; });

describe('blog navigation metadata', () => {
  it('matches the static head, then replaces it on post → post → index navigation', () => {
    document.head.innerHTML = withPageHead('<head><title>Homecast</title></head>', postPageMeta(first))
      .replace(/<\/?head>/g, '');
    const { rerender } = renderHook(({ meta }) => useBlogMeta(meta), { initialProps: { meta: postPageMeta(first) } });
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(schema()['@graph'][0]).toMatchObject({
      headline: 'First post',
      mainEntityOfPage: { '@id': 'https://homecast.cloud/blog/first/' },
      author: { name: 'Rob Parker' },
    });
    expect(schema()['@graph'][1].itemListElement[2].item).toBe('https://homecast.cloud/blog/first/');

    rerender({ meta: postPageMeta(second) });
    expect(document.title).toBe('Second post — Homecast');
    expect(content('meta[property="og:url"]')).toBe('https://homecast.cloud/blog/second/');
    expect(content('meta[property="og:image"]')).toBe(DEFAULT_OG_IMAGE);
    expect(content('meta[property="og:image:alt"]')).toBeUndefined();
    expect(schema()['@graph'][0].headline).toBe('Second post');
    expect(schema()['@graph'][0].image).toBeUndefined();

    rerender({ meta: BLOG_INDEX_META });
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://homecast.cloud/blog/');
    expect(content('meta[property="og:type"]')).toBe('website');
    expect(document.getElementById('blog-structured-data')).toBeNull();
    expect(content('meta[property="article:published_time"]')).toBeUndefined();
  });

  it('clears article metadata when leaving a directly loaded article', () => {
    document.head.innerHTML = withPageHead('<head><title>Homecast</title></head>', postPageMeta(first)).replace(/<\/?head>/g, '');
    const { unmount } = renderHook(() => useBlogMeta(postPageMeta(first)));
    unmount();
    expect(document.title).toBe('Homecast');
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.getElementById('blog-structured-data')).toBeNull();
    expect(content('meta[name="description"]')).not.toBe(first.description);
  });

  it('noindexes missing posts and clears that flag on a valid page', () => {
    const missing: PageMeta = { title: 'Missing', description: 'Missing', type: 'website', noindex: true };
    const { rerender } = renderHook(({ meta }) => useBlogMeta(meta), { initialProps: { meta: missing } });
    expect(content('meta[name="robots"]')).toBe('noindex, follow');
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    rerender({ meta: postPageMeta(first) });
    expect(content('meta[name="robots"]')).toBe('max-image-preview:large');
  });

  it('deduplicates its tags without touching unrelated structured data', () => {
    document.head.innerHTML = '<meta content="old" property="og:title"><meta property="og:title" content="duplicate"><script type="application/ld+json" id="site-schema">{}</script>';
    renderHook(() => useBlogMeta(postPageMeta(first)));
    expect(document.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.getElementById('site-schema')?.textContent).toBe('{}');
  });
});
