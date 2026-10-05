import { Link } from 'react-router-dom';
import { categoryLabel, formatPostDate, type BlogPostMeta } from '@/lib/blog/parse';
import { BLOG_CLASSES, postPath } from '@/lib/blog/prerender';
import { cn } from '@/lib/utils';

/** Quiet metadata shared by the list and article header. */
export function PostKicker({ post, className }: { post: BlogPostMeta; className?: string }) {
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground', className)}>
      <span>{categoryLabel(post.category)}</span>
      <span aria-hidden>·</span>
      <time dateTime={post.date}>{formatPostDate(post.date)}</time>
      <span aria-hidden>·</span>
      <span>{post.readingMinutes} min read</span>
    </p>
  );
}

/** A text-led entry with an optional, small editorial image. */
export function PostCard({ post }: { post: BlogPostMeta }) {
  return (
    <Link to={postPath(post.slug)} className={cn(BLOG_CLASSES.postLink, post.cover && BLOG_CLASSES.postWithImage)}>
      <PostKicker post={post} className={BLOG_CLASSES.postMeta} />
      <h2 className={BLOG_CLASSES.postTitle}>{post.title}</h2>
      <p className={BLOG_CLASSES.postDescription}>{post.description}</p>
      {post.cover && (
        <img src={post.cover} alt="" width={144} height={96} loading="lazy" decoding="async" className={BLOG_CLASSES.postThumbnail} />
      )}
    </Link>
  );
}
