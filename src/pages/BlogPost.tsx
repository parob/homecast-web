import { useEffect, useMemo } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import { Button } from '@/components/ui/button';
import { useBlogMeta } from '@/hooks/useBlogMeta';
import { POSTS, findPost, renderPostBody } from '@/lib/blog/posts';
import { BLOG_REDIRECTS } from '@/lib/blog/redirects';
import { relatedPosts } from '@/lib/blog/parse';
import { BLOG_CLASSES, postPageMeta, postPath } from '@/lib/blog/prerender';
import { PostCard, PostKicker } from '@/components/blog/PostCard';
import { BlogComments } from '@/components/blog/BlogComments';

const NotFoundPost = () => {
  return (
    <section className={BLOG_CLASSES.articleSection}>
      <div className={BLOG_CLASSES.articleColumn}>
        <h1 className="text-3xl font-bold mb-3">We couldn't find that post</h1>
        <p className="text-muted-foreground mb-8">It may have moved, or the link may be mistyped.</p>
        <Button asChild><Link to="/blog/">See all posts</Link></Button>
      </div>
    </section>
  );
};

const BlogPost = () => {
  const { slug } = useParams();
  const { hash, search } = useLocation();
  const redirectSlug = slug && Object.prototype.hasOwnProperty.call(BLOG_REDIRECTS, slug)
    ? BLOG_REDIRECTS[slug] : undefined;
  const post = findPost(slug);
  const html = useMemo(() => (post ? renderPostBody(post) : ''), [post]);
  useBlogMeta(post ? postPageMeta(post) : {
    title: 'Post not found — Homecast',
    description: 'This blog post could not be found.',
    type: 'website',
    noindex: !redirectSlug,
  });

  // Arriving on a new post starts at the top, or at the section a link named.
  useEffect(() => {
    const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) {
      // A section link can point at a disclosure or something inside it.
      // Reveal its ancestors before scrolling so it remains reachable.
      for (let element: HTMLElement | null = target; element; element = element.parentElement) {
        if (element instanceof HTMLDetailsElement) element.open = true;
      }
      target.scrollIntoView();
    }
    else window.scrollTo(0, 0);
  }, [slug, hash]);

  if (redirectSlug) return <Navigate to={{ pathname: postPath(redirectSlug), search, hash }} replace />;

  if (!post) {
    return (
      <div className={BLOG_CLASSES.page}>
        <MarketingHeader />
        <main className={BLOG_CLASSES.main}><NotFoundPost /></main>
        <MarketingFooter />
      </div>
    );
  }

  const related = relatedPosts(post, POSTS);

  return (
    <div className={BLOG_CLASSES.page}>
      <MarketingHeader />
      <main className={BLOG_CLASSES.main}>
        <article className={BLOG_CLASSES.articleSection}>
          <div className={BLOG_CLASSES.articleColumn}>
            <Link
              to="/blog/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="h-4 w-4" /> Blog
            </Link>
            <h1 className={BLOG_CLASSES.title}>{post.title}</h1>
            <PostKicker post={post} className="mb-2" />
            <p className={BLOG_CLASSES.byline}>By {post.author}</p>
            <div className={BLOG_CLASSES.body} dangerouslySetInnerHTML={{ __html: html }} />
            <BlogComments key={post.slug} slug={post.slug} />
          </div>
        </article>

        {related.length > 0 && (
          <section className="w-full px-6 pb-16">
            <div className={BLOG_CLASSES.articleColumn}>
              <h2 className="text-lg font-semibold tracking-tight mb-4">More from the blog</h2>
              <ul className={BLOG_CLASSES.postList}>
                {related.map((p) => <li key={p.slug}><PostCard post={p} /></li>)}
              </ul>
            </div>
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
};

export default BlogPost;
