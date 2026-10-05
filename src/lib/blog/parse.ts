/**
 * The blog's content model: frontmatter, markdown, and the little arithmetic
 * around a post (reading time, ordering, what's related).
 *
 * Imported from two places that share almost nothing — the /blog pages in the
 * browser, and the prerender plugin in vite.config.ts running under Node. So it
 * is a leaf on purpose: no DOM, no `fs`, no `Buffer`. That is also why the
 * frontmatter parser is hand-rolled rather than gray-matter, which needs Node.
 */
import { Marked, type Tokens } from 'marked';

export type BlogCategory = 'guide' | 'news' | 'thoughts';

export const BLOG_CATEGORIES: readonly { id: BlogCategory; label: string }[] = [
  { id: 'guide', label: 'Guides' },
  { id: 'news', label: 'News' },
  { id: 'thoughts', label: 'Thoughts' },
];

export const categoryLabel = (id: BlogCategory): string =>
  BLOG_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  category: BlogCategory;
  author: string;
  tags: string[];
  cover?: string;
  coverAlt?: string;
  /** Leads the blog index. If none is featured, the newest post leads. */
  featured: boolean;
  readingMinutes: number;
}

export interface BlogPost extends BlogPostMeta {
  /** The markdown, frontmatter removed. */
  body: string;
}

/** Intrinsic pixel size of an image under public/, so figures don't jump. */
export type ImageSizes = Record<string, { width: number; height: number }>;

// ── Frontmatter ─────────────────────────────────────────────────────────────

type FrontmatterValue = string | string[];

/**
 * Parses the YAML subset our posts use: `key: value` lines, with values
 * optionally single- or double-quoted, and inline `[a, b]` lists. Anything
 * richer is a mistake in a post, not something to support.
 */
export function parseFrontmatter(raw: string): { data: Record<string, FrontmatterValue>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('missing frontmatter (--- block at the top of the file)');
  const [, head, body] = match;

  const data: Record<string, FrontmatterValue> = {};
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error(`unreadable frontmatter line: "${line}"`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    data[key] = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map((v) => unquote(v.trim())).filter(Boolean)
      : unquote(value);
  }
  return { data, body };
}

function unquote(value: string): string {
  const q = value[0];
  if ((q === '"' || q === "'") && value.endsWith(q) && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

// ── Posts ───────────────────────────────────────────────────────────────────

const REQUIRED = ['title', 'description', 'date', 'category', 'author'] as const;

/** `/content/blog/some-post.md` → `some-post`. */
export const slugFromPath = (path: string): string =>
  path.split('/').pop()!.replace(/\.md$/, '');

export function parsePost(slug: string, raw: string): BlogPost {
  const { data, body } = parseFrontmatter(raw);
  const str = (key: string): string | undefined => {
    const v = data[key];
    if (Array.isArray(v)) throw new Error(`${slug}: "${key}" must be a single value`);
    return v || undefined;
  };

  for (const key of REQUIRED) {
    if (!str(key)) throw new Error(`${slug}: frontmatter is missing "${key}"`);
  }
  const category = str('category') as BlogCategory;
  if (!BLOG_CATEGORIES.some((c) => c.id === category)) {
    throw new Error(`${slug}: unknown category "${category}"`);
  }
  const date = str('date')!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error(`${slug}: date must be YYYY-MM-DD, got "${date}"`);
  }
  const tags = data.tags ?? [];

  return {
    slug,
    title: str('title')!,
    description: str('description')!,
    date,
    category,
    author: str('author')!,
    tags: Array.isArray(tags) ? tags : [tags],
    cover: str('cover'),
    coverAlt: str('coverAlt'),
    featured: str('featured') === 'true',
    readingMinutes: readingMinutes(body),
    body,
  };
}

/** Newest first; a tie falls back to the title so the order is stable. */
export const sortPosts = <T extends BlogPostMeta>(posts: readonly T[]): T[] =>
  [...posts].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

/** The index pins its featured post; feeds and related posts keep date order. */
export const sortIndexPosts = <T extends BlogPostMeta>(posts: readonly T[]): T[] =>
  sortPosts(posts).sort((a, b) => Number(b.featured) - Number(a.featured));

/**
 * Up to `limit` other posts, most shared tags first, then same category, then
 * newest. Never empty while there are other posts — a dead end at the bottom
 * of an article is worse than a loosely related link.
 */
export function relatedPosts<T extends BlogPostMeta>(post: BlogPostMeta, all: readonly T[], limit = 3): T[] {
  const score = (p: BlogPostMeta) =>
    p.tags.filter((t) => post.tags.includes(t)).length * 2 + (p.category === post.category ? 1 : 0);
  return sortPosts(all.filter((p) => p.slug !== post.slug))
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map(({ p }) => p);
}

/** Words / 220, never under a minute. Code blocks count — people read them. */
export function readingMinutes(markdown: string): number {
  const words = markdown.replace(/[#>*_`[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** "2026-10-05" → "5 October 2026", fixed to UTC so server and browser agree. */
export const formatPostDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

// ── Markdown ────────────────────────────────────────────────────────────────

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Heading text → an anchor id: "Part 2: the train light" → "part-2-the-train-light". */
export const headingId = (text: string): string =>
  text.toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

const isExternal = (href: string) => /^https?:\/\//.test(href) && !/^https?:\/\/(www\.)?homecast\.cloud(\/|$)/.test(href);

/**
 * Markdown → HTML for a post body.
 *
 * - `## Heading` gets an id, so a section can be linked to.
 * - Links off homecast.cloud open in a new tab.
 * - `![alt](src "caption")` becomes a <figure>; with `sizes`, it carries its
 *   intrinsic width and height so the page doesn't move as images arrive.
 *
 * The output goes through dangerouslySetInnerHTML, which is safe only because
 * every input is a file in this repo, reviewed like code. Never feed it
 * anything a user typed.
 */
export function renderMarkdown(markdown: string, sizes: ImageSizes = {}): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        return `<h${depth} id="${headingId(inner)}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        const ext = isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeHtml(href)}"${t}${ext}>${inner}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const size = sizes[href];
        const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
        const img = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(text)} — open full-size image"><img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${dims} loading="lazy" decoding="async"></a>`;
        return title
          ? `<figure>${img}<figcaption>${escapeHtml(title)}</figcaption></figure>`
          : `<figure>${img}</figure>`;
      },
      // A paragraph holding only an image would wrap a <figure> in a <p>,
      // which is invalid HTML and lets the browser split it apart.
      paragraph({ tokens }: Tokens.Paragraph) {
        const inner = this.parser.parseInline(tokens);
        return /^<figure>[\s\S]*<\/figure>$/.test(inner.trim()) ? `${inner}\n` : `<p>${inner}</p>\n`;
      },
    },
  });
  // Wide tables scroll inside themselves rather than widening the page.
  return (marked.parse(markdown, { async: false }) as string)
    .replace(/<table>/g, '<div class="blog-table"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

/** Every image a post references: its cover plus each `![…](src)` in the body. */
export function referencedImages(post: Pick<BlogPost, 'cover' | 'coverAlt' | 'body'>): { src: string; alt: string }[] {
  const found: { src: string; alt: string }[] = post.cover ? [{ src: post.cover, alt: post.coverAlt ?? '' }] : [];
  const re = /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
  for (let m = re.exec(post.body); m; m = re.exec(post.body)) found.push({ alt: m[1], src: m[2] });
  return found;
}
