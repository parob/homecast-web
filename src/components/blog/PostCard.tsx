import { Link } from 'react-router-dom';
import { imageSizes } from '@/lib/blog/posts';
import { categoryLabel, formatPostDate, type BlogPostMeta } from '@/lib/blog/parse';
import { BLOG_CLASSES, postPath } from '@/lib/blog/prerender';
import { cn } from '@/lib/utils';

/** A post's date line: category, date, reading time. */
export function PostKicker({ post, className }: { post: BlogPostMeta; className?: string }) {
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground', className)}>
      <span className={BLOG_CLASSES.categoryPill}>{categoryLabel(post.category)}</span>
      <time dateTime={post.date}>{formatPostDate(post.date)}</time>
      <span aria-hidden>·</span>
      <span>{post.readingMinutes} min read</span>
    </p>
  );
}

function CoverImage({ post, className }: { post: BlogPostMeta; className?: string }) {
  if (!post.cover) {
    // No cover: a quiet tinted panel keeps the grid's rhythm.
    return <div className={cn('aspect-[16/9] rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5', className)} />;
  }
  const size = imageSizes[post.cover];
  return (
    <img
      src={post.cover}
      alt={post.coverAlt ?? ''}
      width={size?.width}
      height={size?.height}
      loading="lazy"
      decoding="async"
      className={cn('aspect-[16/9] w-full rounded-2xl border border-border object-cover bg-muted', className)}
    />
  );
}

/** One post as a card, for the index and the "keep reading" row. */
export function PostCard({ post, featured = false }: { post: BlogPostMeta; featured?: boolean }) {
  return (
    <Link
      to={postPath(post.slug)}
      className={cn('group block', featured && 'md:grid md:grid-cols-[3fr_2fr] md:items-center md:gap-10')}
    >
      <CoverImage post={post} className="transition-opacity group-hover:opacity-90" />
      <div className={featured ? 'mt-5 md:mt-0' : 'mt-4'}>
        <PostKicker post={post} className="mb-2" />
        <h2 className={cn(
          'font-semibold tracking-tight group-hover:text-primary transition-colors',
          featured ? 'text-2xl sm:text-3xl mb-3' : 'text-lg mb-1.5',
        )}>
          {post.title}
        </h2>
        <p className={cn('text-muted-foreground leading-relaxed', featured ? 'text-base' : 'text-sm')}>
          {post.description}
        </p>
      </div>
    </Link>
  );
}
