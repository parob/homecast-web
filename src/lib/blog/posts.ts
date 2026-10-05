/**
 * Every post, parsed, for the /blog pages in the browser.
 *
 * Eager, because the index needs every title and the posts are small — but only
 * Blog.tsx and BlogPost.tsx import this, and both are lazy routes, so none of it
 * lands in the app's main bundle. Image sizes come from the build (see
 * blogPlugin in vite.config.ts), read from the files themselves.
 */
import imageSizes from 'virtual:blog-image-sizes';
import { parsePost, renderMarkdown, slugFromPath, sortPosts, type BlogPost } from './parse';

const files = import.meta.glob('/content/blog/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const POSTS: readonly BlogPost[] = sortPosts(
  Object.entries(files).map(([path, raw]) => parsePost(slugFromPath(path), raw)),
);

export const findPost = (slug: string | undefined): BlogPost | undefined =>
  POSTS.find((p) => p.slug === slug);

export const renderPostBody = (post: BlogPost): string => renderMarkdown(post.body, imageSizes);

export { imageSizes };
