import settings from '../../../content/blog-comments.json';

export interface CommentsConfig {
  repo: `${string}/${string}`;
  repoId: string;
  category: string;
  categoryId: string;
}

export function readCommentsConfig(value: typeof settings): CommentsConfig | null {
  if (!/^[\w.-]+\/[\w.-]+$/.test(value.repo) || !value.repoId.trim()
    || !value.category.trim() || !value.categoryId.trim()) return null;
  return value as CommentsConfig;
}

// The two public IDs come from giscus.app after the repository is enabled.
// An incomplete configuration must never send readers to a broken embed.
export const BLOG_COMMENTS = readCommentsConfig(settings);
