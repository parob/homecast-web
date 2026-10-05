import { useSearchParams } from 'react-router-dom';
import { Rss } from 'lucide-react';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';
import { PostCard } from '@/components/blog/PostCard';
import { POSTS } from '@/lib/blog/posts';
import { BLOG_CATEGORIES, type BlogCategory } from '@/lib/blog/parse';
import { BLOG_CLASSES, BLOG_INDEX_META, BLOG_INTRO } from '@/lib/blog/prerender';
import { cn } from '@/lib/utils';

const isCategory = (v: string | null): v is BlogCategory => BLOG_CATEGORIES.some((c) => c.id === v);

const Blog = () => {
  useDocumentMeta(BLOG_INDEX_META.title, BLOG_INDEX_META.description);
  const [params, setParams] = useSearchParams();
  const raw = params.get('category');
  const category = isCategory(raw) ? raw : null;

  const posts = category ? POSTS.filter((p) => p.category === category) : POSTS;
  // The newest post leads only on the unfiltered view; a filter is a list.
  const featured = category ? undefined : (posts.find((p) => p.featured) ?? posts[0]);
  const rest = posts.filter((p) => p !== featured);

  const chip = (id: BlogCategory | null, label: string) => (
    <button
      key={label}
      type="button"
      onClick={() => setParams(id ? { category: id } : {}, { replace: true })}
      aria-pressed={category === id}
      className={cn(
        'rounded-full px-3.5 py-1.5 text-sm transition-colors',
        category === id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className={BLOG_CLASSES.page}>
      <MarketingHeader />
      <main className={BLOG_CLASSES.main}>
        <section className="w-full px-6 pt-10 pb-20 sm:pt-14">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
              <div className="max-w-2xl">
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3">Blog</h1>
                <p className="text-lg text-muted-foreground leading-relaxed">{BLOG_INTRO}</p>
              </div>
              <a
                href="/blog/feed.xml"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Rss className="h-4 w-4" /> RSS
              </a>
            </div>

            <div className="flex flex-wrap gap-2 mb-10" role="group" aria-label="Filter by category">
              {chip(null, 'All')}
              {BLOG_CATEGORIES.map((c) => chip(c.id, c.label))}
            </div>

            {featured && (
              <div className="mb-14">
                <PostCard post={featured} featured />
              </div>
            )}

            {rest.length > 0 ? (
              <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((p) => <PostCard key={p.slug} post={p} />)}
              </div>
            ) : !featured && (
              <p className="text-muted-foreground">Nothing here yet.</p>
            )}
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
};

export default Blog;
