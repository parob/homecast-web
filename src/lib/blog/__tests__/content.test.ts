/**
 * Checks the real posts in content/blog, the way a reviewer would: every one
 * parses, links resolve, images exist and say what they show. A post is code
 * that happens to be prose — a broken one should fail CI, not ship.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BLOG_REDIRECTS } from '../redirects';
import { parsePost, referencedImages, slugFromPath } from '../parse';

const root = path.resolve(__dirname, '../../../..');
const contentDir = path.join(root, 'content/blog');
const files = fs.existsSync(contentDir) ? fs.readdirSync(contentDir).filter((f) => f.endsWith('.md')) : [];
const posts = files.map((f) => parsePost(slugFromPath(f), fs.readFileSync(path.join(contentDir, f), 'utf-8')));
const slugs = new Set(posts.map((p) => p.slug));

describe('blog content', () => {
  it('has posts', () => {
    expect(posts.length).toBeGreaterThan(0);
  });

  it('keeps retired URLs out of the index and points them at existing posts', () => {
    for (const [oldSlug, target] of Object.entries(BLOG_REDIRECTS)) {
      expect(slugs.has(oldSlug)).toBe(false);
      expect(slugs.has(target)).toBe(true);
    }
  });

  it('features at most one post', () => {
    expect(posts.filter((p) => p.featured).length).toBeLessThanOrEqual(1);
  });

  it('uses unique titles', () => {
    expect(new Set(posts.map((p) => p.title)).size).toBe(posts.length);
  });

  describe.each(posts.map((p) => [p.slug, p] as const))('%s', (slug, post) => {
    it('has a URL-safe slug', () => {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it('is not dated in the future', () => {
      expect(Date.parse(post.date)).toBeLessThanOrEqual(Date.now());
    });

    it('has a description that fits a search result', () => {
      expect(post.description.length).toBeLessThanOrEqual(160);
    });

    it('describes every image, and every image exists', () => {
      for (const { src, alt } of referencedImages(post)) {
        expect(alt.trim(), `${src} needs alt text`).not.toBe('');
        expect(src.startsWith('/'), `${src} should be a site path`).toBe(true);
        expect(fs.existsSync(path.join(root, 'public', src)), `${src} is missing from public/`).toBe(true);
      }
    });

    it('keeps its cover light enough for a card grid', () => {
      if (!post.cover) return;
      expect(fs.statSync(path.join(root, 'public', post.cover)).size).toBeLessThanOrEqual(300 * 1024);
    });

    it('links only to posts that exist', () => {
      for (const [, target] of post.body.matchAll(/\]\(\/blog\/([a-z0-9-]+)\/?(?:#[^)]*)?\)/g)) {
        expect(slugs.has(target), `/blog/${target} does not exist`).toBe(true);
      }
    });
  });
});
