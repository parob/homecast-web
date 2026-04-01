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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    // TEMPORARY: preserve component names for debugging React error #300
    minify: 'esbuild',
    target: 'es2020',
  },
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
