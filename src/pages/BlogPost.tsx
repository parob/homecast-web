import { useEffect, useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import { Button } from '@/components/ui/button';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';
import { POSTS, findPost, imageSizes, renderPostBody } from '@/lib/blog/posts';
import { relatedPosts } from '@/lib/blog/parse';
import { BLOG_CLASSES, postPageTitle } from '@/lib/blog/prerender';
import { PostCard, PostKicker } from '@/components/blog/PostCard';

const NotFoundPost = () => {
  useDocumentMeta('Post not found — Homecast');
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
  const { hash } = useLocation();
  const post = findPost(slug);
  const html = useMemo(() => (post ? renderPostBody(post) : ''), [post]);
  useDocumentMeta(post ? postPageTitle(post) : 'Blog — Homecast', post?.description);

  // Arriving on a new post starts at the top, or at the section a link named.
  useEffect(() => {
    const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [slug, hash]);

  if (!post) {
    return (
      <div className={BLOG_CLASSES.page}>
        <MarketingHeader />
        <main className={BLOG_CLASSES.main}><NotFoundPost /></main>
        <MarketingFooter />
      </div>
    );
  }

  const cover = post.cover ? imageSizes[post.cover] : undefined;
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
            <PostKicker post={post} className="mb-4" />
            <h1 className={BLOG_CLASSES.title}>{post.title}</h1>
            <p className={BLOG_CLASSES.standfirst}>{post.description}</p>
            <p className={BLOG_CLASSES.byline}>By {post.author}</p>
            {post.cover && (
              <img
                src={post.cover}
                alt={post.coverAlt ?? ''}
                width={cover?.width}
                height={cover?.height}
                className={BLOG_CLASSES.cover}
              />
            )}
            <div className={BLOG_CLASSES.body} dangerouslySetInnerHTML={{ __html: html }} />
            {post.generatedPhotos && (
              <p className="mt-10 text-xs text-muted-foreground">Photos are illustrative and AI-generated.</p>
            )}

            <aside className="mt-14 rounded-2xl border border-border bg-muted/40 p-6 sm:p-8">
              <h2 className="text-lg font-semibold mb-2">Try it on your own Apple Home</h2>
              <p className="text-muted-foreground mb-5">
                Homecast connects Apple Home to Android, the web, Home Assistant, AI assistants and your own code.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild><Link to="/pricing">See plans</Link></Button>
                <Button variant="outline" asChild>
                  <a href="https://docs.homecast.cloud"><BookOpen className="h-4 w-4 mr-1.5" />Read the docs</a>
                </Button>
              </div>
            </aside>
          </div>
        </article>

        {related.length > 0 && (
          <section className="w-full border-t border-border px-6 py-16">
            <div className="mx-auto max-w-6xl">
              <h2 className="text-2xl font-bold tracking-tight mb-8">Keep reading</h2>
              <div className="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((p) => <PostCard key={p.slug} post={p} />)}
              </div>
            </div>
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
};

export default BlogPost;
