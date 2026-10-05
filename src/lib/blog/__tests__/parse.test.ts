import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter, parsePost, readingMinutes, relatedPosts, renderMarkdown,
  slugFromPath, sortPosts, sortIndexPosts, headingId, referencedImages, type BlogPostMeta,
} from '../parse';

const post = (fm: string, body = 'Hello.') => `---\n${fm}\n---\n${body}`;
const FULL = [
  'title: "Moving to Home Assistant: the easy way"',
  'description: One sentence.',
  'date: 2026-10-05',
  'category: guide',
  'author: Rob Parker',
  'tags: [home-assistant, migration]',
].join('\n');

describe('parseFrontmatter', () => {
  it('reads quoted values, colons inside quotes, and inline lists', () => {
    const { data, body } = parseFrontmatter(post(FULL, '# Body'));
    expect(data.title).toBe('Moving to Home Assistant: the easy way');
    expect(data.tags).toEqual(['home-assistant', 'migration']);
    expect(body).toBe('# Body');
  });

  it('refuses a file with no frontmatter rather than guessing', () => {
    expect(() => parseFrontmatter('# Just markdown')).toThrow(/missing frontmatter/);
  });

  it('refuses a line it cannot read', () => {
    expect(() => parseFrontmatter(post('just words'))).toThrow(/unreadable/);
  });
});

describe('parsePost', () => {
  it('builds a post with computed reading time', () => {
    const p = parsePost('ha', post(FULL));
    expect(p).toMatchObject({ slug: 'ha', category: 'guide', author: 'Rob Parker', featured: false });
    expect(p.readingMinutes).toBe(1);
  });

  it.each(['title', 'description', 'date', 'category', 'author'])('requires %s', (key) => {
    const fm = FULL.split('\n').filter((l) => !l.startsWith(`${key}:`)).join('\n');
    expect(() => parsePost('x', post(fm))).toThrow(new RegExp(`missing "${key}"`));
  });

  it('rejects an unknown category and a malformed date', () => {
    expect(() => parsePost('x', post(FULL.replace('category: guide', 'category: rumour')))).toThrow(/unknown category/);
    expect(() => parsePost('x', post(FULL.replace('2026-10-05', '5 Oct 2026')))).toThrow(/YYYY-MM-DD/);
  });

  it('reads the featured flag', () => {
    expect(parsePost('x', post(`${FULL}\nfeatured: true`)).featured).toBe(true);
  });
});

describe('ordering', () => {
  const meta = (slug: string, date: string, extra: Partial<BlogPostMeta> = {}): BlogPostMeta => ({
    slug, title: slug, description: '', date, category: 'news', author: 'a', tags: [],
    featured: false, readingMinutes: 1, ...extra,
  });

  it('sorts newest first, ties by title', () => {
    const sorted = sortPosts([meta('b', '2026-01-01'), meta('c', '2026-02-01'), meta('a', '2026-01-01')]);
    expect(sorted.map((p) => p.slug)).toEqual(['c', 'a', 'b']);
  });

  it('pins the featured post only in index order without mutating the source', () => {
    const posts = [meta('older', '2026-01-01'), meta('newest', '2026-03-01'), meta('launch', '2026-02-01', { featured: true })];
    expect(sortIndexPosts(posts).map((p) => p.slug)).toEqual(['launch', 'newest', 'older']);
    expect(sortPosts(posts).map((p) => p.slug)).toEqual(['newest', 'launch', 'older']);
    expect(posts.map((p) => p.slug)).toEqual(['older', 'newest', 'launch']);
  });

  it('ranks related posts by shared tags, then category, never itself', () => {
    const me = meta('me', '2026-03-01', { tags: ['mqtt'], category: 'guide' });
    const all = [
      me,
      meta('same-tag', '2026-01-01', { tags: ['mqtt'] }),
      meta('same-category', '2026-02-01', { category: 'guide' }),
      meta('newest-unrelated', '2026-09-01'),
    ];
    expect(relatedPosts(me, all).map((p) => p.slug)).toEqual(['same-tag', 'same-category', 'newest-unrelated']);
  });

  it('derives the slug from the file name', () => {
    expect(slugFromPath('/content/blog/local-mode.md')).toBe('local-mode');
  });
});

describe('readingMinutes', () => {
  it('is at least a minute and grows with length', () => {
    expect(readingMinutes('short')).toBe(1);
    expect(readingMinutes('word '.repeat(1100))).toBe(5);
  });
});

describe('renderMarkdown', () => {
  it('gives headings linkable ids', () => {
    expect(renderMarkdown('## Part 2: the train light')).toContain('<h2 id="part-2-the-train-light">');
    expect(headingId('What’s <code>new</code>?')).toBe('whats-new');
  });

  it('opens other sites in a new tab, but not our own', () => {
    expect(renderMarkdown('[TfL](https://api.tfl.gov.uk)')).toContain('target="_blank" rel="noopener noreferrer"');
    expect(renderMarkdown('[Pricing](/pricing)')).not.toContain('target=');
    expect(renderMarkdown('[Home](https://homecast.cloud/pricing)')).not.toContain('target=');
  });

  it('turns a lone image into a figure with its caption and size, not a <p>', () => {
    const html = renderMarkdown('![A lamp](/blog/x/lamp.webp "The hall lamp")', {
      '/blog/x/lamp.webp': { width: 1600, height: 900 },
    });
    expect(html).toContain('<figure><a href="/blog/x/lamp.webp" target="_blank" rel="noopener noreferrer" aria-label="A lamp — open full-size image">');
    expect(html).toContain('<img src="/blog/x/lamp.webp" alt="A lamp" width="1600" height="900"');
    expect(html).toContain('<figcaption>The hall lamp</figcaption></figure>');
    expect(html).not.toContain('<p><figure>');
  });

  it('wraps tables so they scroll on their own', () => {
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toMatch(/^<div class="blog-table"><table>/);
  });

  it('escapes code', () => {
    expect(renderMarkdown('```js\nif (a < b) {}\n```')).toContain('a &lt; b');
  });

  it('renders copyable code and Markdown inside a closed native disclosure', () => {
    const html = renderMarkdown('<details id="setup">\n<summary>Set it up</summary>\n\n**Copy this:**\n\n```js\nreturn 2 < 3;\n```\n\n</details>\n\nAfterwards.');
    expect(html).toContain('<details id="setup">');
    expect(html).not.toContain('<details open');
    expect(html).toContain('<p><strong>Copy this:</strong></p>');
    expect(html).toContain('<pre><code class="language-js">return 2 &lt; 3;');
    expect(html).toMatch(/<\/details>\s*<p>Afterwards\.<\/p>/);
  });
});

describe('referencedImages', () => {
  it('lists the cover and every body image with its alt', () => {
    expect(referencedImages({ cover: '/blog/a/cover.webp', coverAlt: 'Door', body: 'x ![Lamp](/blog/a/l.webp "c") y ![](/blog/a/m.svg)' }))
      .toEqual([
        { src: '/blog/a/cover.webp', alt: 'Door' },
        { src: '/blog/a/l.webp', alt: 'Lamp' },
        { src: '/blog/a/m.svg', alt: '' },
      ]);
  });
});
