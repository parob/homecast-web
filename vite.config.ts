import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
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
    generateBundle() {
      const src = fs.readFileSync(path.resolve(__dirname, 'service-worker.js'), 'utf-8');
      if (!src.includes('__BUILD_SHA__')) {
        this.error('service-worker.js has no __BUILD_SHA__ placeholder — updates would never install');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src.replace(/__BUILD_SHA__/g, sha) });
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
