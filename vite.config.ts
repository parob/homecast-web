import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { componentTagger } from "lovable-tagger";

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
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    versionPlugin(commitSha, deployTime),
    serviceWorkerPlugin(commitSha),
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
