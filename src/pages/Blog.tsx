import { useSearchParams } from 'react-router-dom';
import { Rss } from 'lucide-react';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import { useBlogMeta } from '@/hooks/useBlogMeta';
import { PostCard } from '@/components/blog/PostCard';
import { POSTS } from '@/lib/blog/posts';
import { BLOG_CATEGORIES, sortIndexPosts, type BlogCategory } from '@/lib/blog/parse';
import { BLOG_CLASSES, BLOG_INDEX_META, BLOG_INTRO } from '@/lib/blog/prerender';
import { cn } from '@/lib/utils';

const categories = BLOG_CATEGORIES.filter((c) => POSTS.some((post) => post.category === c.id));
const indexPosts = sortIndexPosts(POSTS);
const isCategory = (v: string | null): v is BlogCategory => categories.some((c) => c.id === v);

const Blog = () => {
  useBlogMeta(BLOG_INDEX_META);
  const [params, setParams] = useSearchParams();
  const raw = params.get('category');
  const category = isCategory(raw) ? raw : null;

  const posts = category ? indexPosts.filter((p) => p.category === category) : indexPosts;

  const chip = (id: BlogCategory | null, label: string) => (
    <button
      key={label}
      type="button"
      onClick={() => setParams(id ? { category: id } : {}, { replace: true })}
      aria-pressed={category === id}
      className={cn(
        'min-h-11 border-b-2 px-1 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4',
        category === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className={BLOG_CLASSES.page}>
      <MarketingHeader />
      <main className={BLOG_CLASSES.main}>
        <section className={BLOG_CLASSES.articleSection}>
          <div className={BLOG_CLASSES.articleColumn}>
            <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
              <div className="max-w-2xl">
                <h1 className={BLOG_CLASSES.title}>Blog</h1>
                <p className="text-base text-muted-foreground leading-relaxed">{BLOG_INTRO}</p>
              </div>
              <a
                href="/blog/feed.xml"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Rss className="h-4 w-4" /> RSS
              </a>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1 mb-2" role="group" aria-label="Filter by category">
              {chip(null, 'All')}
              {categories.map((c) => chip(c.id, c.label))}
            </div>

            {posts.length > 0 ? (
              <ul className={BLOG_CLASSES.postList}>
                {posts.map((p) => <li key={p.slug}><PostCard post={p} /></li>)}
              </ul>
            ) : (
              <p className="py-8 text-muted-foreground">Nothing here yet.</p>
            )}
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
};

export default Blog;
