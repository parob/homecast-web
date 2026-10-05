import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { componentTagger } from "lovable-tagger";
import { parsePost, renderMarkdown, slugFromPath, sortPosts, type ImageSizes } from "./src/lib/blog/parse";
import { imageSize } from "./src/lib/blog/image-size";
import {
  BLOG_INDEX_META, postPageTitle, postPath, renderIndexPage, renderPostPage, renderRss, renderSitemap,
  withPageHead, withRootContent,
} from "./src/lib/blog/prerender";
import { MARKETING_PATHS } from "./src/lib/marketing-routes";

const commitSha = process.env.GITHUB_SHA?.slice(0, 7) || 'dev';
const deployTime = process.env.DEPLOY_TIME || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function versionPlugin(sha: string, deployedAt: string): Plugin {
  return {
    name: 'version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: sha, deployedAt }) });
    },
  };
}

/**
 * Emits service-worker.js to /sw.js with the build SHA substituted in.
 *
 * The substitution is what makes updates work at all: a browser reinstalls a
 * worker only when its bytes differ, so a worker without a per-build token
 * would install once and serve that shell forever. It's emitted rather than
 * dropped in public/ so it can't ship unsubstituted.
 */
function serviceWorkerPlugin(sha: string): Plugin {
  return {
    name: 'service-worker',
    // order: 'post' — Vite's own html plugin emits index.html from its
    // generateBundle, and without this ours ran first and never saw the
    // document it is supposed to be versioning.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
      const src = fs.readFileSync(path.resolve(__dirname, 'service-worker.js'), 'utf-8');
      if (!src.includes('__BUILD_SHA__')) {
        this.error('service-worker.js has no __BUILD_SHA__ placeholder — updates would never install');
      }

      // Stamp the worker with a hash of index.html, NOT the commit SHA.
      // GITHUB_SHA here is homecast-cloud's, because that is the repo the
      // deploy workflow runs in — so a web-only change produced byte-identical
      // sw.js, the browser saw no reason to reinstall the worker, and every
      // client kept serving the previous shell until some unrelated server
      // commit happened along. Shipped fixes silently failed to arrive.
      //
      // index.html and not the entry chunk, which is what this used to hash.
      // The one thing the shell cache holds IS index.html, and index.html names
      // the stylesheet as well as the entry script — so a CSS-only deploy moved
      // the document without moving the entry hash. sw.js stayed identical, the
      // worker never reinstalled, and it went on serving a cached shell that
      // pointed at a stylesheet the deploy had deleted. That is an unrecoverable
      // "Unable to preload CSS" on every launch, because the same worker that
      // serves the bad shell is the one that would have replaced it.
      //
      // Hashing the document itself makes the rule exact: the shell cache is
      // thrown away when, and only when, the shell changes.
      const indexHtml = bundle['index.html'];
      const indexSource =
        indexHtml && indexHtml.type === 'asset' ? indexHtml.source.toString() : undefined;

      const entry = Object.values(bundle).find(
        (chunk) => chunk.type === 'chunk' && (chunk as { isEntry?: boolean }).isEntry
      ) as { fileName?: string } | undefined;

      // Fall back to the entry hash, then the commit SHA. Both are worse, but a
      // worker that can still tell two builds apart beats no worker at all.
      const stamp = indexSource
        ? crypto.createHash('sha256').update(indexSource).digest('hex').slice(0, 12)
        : (entry?.fileName?.match(/-([A-Za-z0-9_-]{6,})\.js$/)?.[1] ?? sha);

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src.replace(/__BUILD_SHA__/g, stamp) });
      },
    },
  };
}

/**
 * The blog: image sizes for the browser, and static pages for everyone else.
 *
 * `virtual:blog-image-sizes` maps each file under public/blog to its pixel
 * size, so a figure reserves its space before the image arrives. It is read
 * from the files on each build rather than committed, so it can't go stale.
 *
 * At build it also writes a real document per post (blog/<slug>/index.html),
 * the index, sitemap.xml and an RSS feed — see src/lib/blog/prerender.ts for
 * why. order: 'post' for the same reason as serviceWorkerPlugin: it needs the
 * index.html Vite emits, which only exists once Vite's own hook has run. The
 * template is read, never modified, so sw.js's stamp is unaffected.
 */
function blogPlugin(): Plugin {
  const VIRTUAL = 'virtual:blog-image-sizes';
  const publicDir = path.resolve(__dirname, 'public');
  const contentDir = path.resolve(__dirname, 'content/blog');

  const readImageSizes = (): ImageSizes => {
    const sizes: ImageSizes = {};
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(png|jpe?g|webp|svg)$/i.test(entry.name)) continue;
        const size = imageSize(fs.readFileSync(full));
        if (size) sizes['/' + path.relative(publicDir, full).split(path.sep).join('/')] = size;
      }
    };
    walk(path.join(publicDir, 'blog'));
    return sizes;
  };

  const readPosts = () => sortPosts(
    fs.existsSync(contentDir)
      ? fs.readdirSync(contentDir).filter((f) => f.endsWith('.md'))
          .map((f) => parsePost(slugFromPath(f), fs.readFileSync(path.join(contentDir, f), 'utf-8')))
      : [],
  );

  return {
    name: 'blog',
    resolveId(id) {
      return id === VIRTUAL ? '\0' + VIRTUAL : undefined;
    },
    load(id) {
      return id === '\0' + VIRTUAL ? `export default ${JSON.stringify(readImageSizes())};` : undefined;
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['index.html'];
        if (!index || index.type !== 'asset') return;
        const template = index.source.toString();
        const sizes = readImageSizes();
        const posts = readPosts();

        for (const post of posts) {
          const html = withRootContent(
            withPageHead(template, {
              title: postPageTitle(post),
              description: post.description,
              path: postPath(post.slug),
              image: post.cover,
              imageAlt: post.coverAlt,
              type: 'article',
              publishedTime: post.date,
              author: post.author,
            }),
            renderPostPage(post, renderMarkdown(post.body, sizes), post.cover ? sizes[post.cover] : undefined),
          );
          this.emitFile({ type: 'asset', fileName: `blog/${post.slug}/index.html`, source: html });
        }

        this.emitFile({
          type: 'asset',
          fileName: 'blog/index.html',
          source: withRootContent(withPageHead(template, { ...BLOG_INDEX_META, path: '/blog/' }), renderIndexPage(posts)),
        });
        this.emitFile({ type: 'asset', fileName: 'blog/feed.xml', source: renderRss(posts) });
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: renderSitemap([...MARKETING_PATHS, '/support', '/blog/'], posts),
        });
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  esbuild: {
    keepNames: true,
  },
  server: {
    host: "::",
    port: 8080,
    watch: {
      usePolling: true
    }
  },
  define: {
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha),
    // The same value versionPlugin writes into /version.json, baked into the
    // bundle so a running tab can name the build it is *itself* running.
    //
    // Reading the served version.json at boot would not do: the whole case
    // worth catching is a service worker answering from a shell one build
    // behind, where the served version.json is already the newer one. See
    // lib/update-check.ts.
    'import.meta.env.VITE_DEPLOY_TIME': JSON.stringify(deployTime),
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    versionPlugin(commitSha, deployTime),
    serviceWorkerPlugin(commitSha),
    blogPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @homecast/cloud: resolves to src/cloud/ if it exists (full build),
      // otherwise falls back to src/cloud-stub.ts (Community-only build).
      // To build Community-only: delete or rename src/cloud/
      "@homecast/cloud": fs.existsSync(path.resolve(__dirname, "src/cloud/index.ts"))
        ? path.resolve(__dirname, "src/cloud/index.ts")
        : path.resolve(__dirname, "src/cloud-stub.ts"),
    },
  },
}));
