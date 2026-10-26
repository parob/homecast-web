import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // Per-file environment via `// @vitest-environment jsdom` (see TutorialDialog.test.tsx).
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Scoped to the automation system rather than the whole app: these are
      // the surfaces we hold to a coverage bar. `all` matters — without it v8
      // only reports files some test happened to import, so an entirely
      // untested file silently vanishes from the report instead of showing 0%.
      all: true,
      include: [
        'src/automation/**/*.ts',
        'src/components/automation-editor/**/*.{ts,tsx}',
        'src/server/community-automation.ts',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/__tests__/**',
        // Type-only module: no runtime behaviour to exercise beyond the
        // factories, which the engine tests already cover.
        'src/automation/types/execution.ts',
      ],
      // A ratchet, not the goal. Set just under the current numbers so coverage
      // can only go up; raise these as each wave of tests lands, until the
      // 90% target is the floor. Failing the build on a drop is the point —
      // every editor bug found so far lived in a file at 0%.
      //
      // `functions` moved DOWN from 78 to 67 once, deliberately. It is a ratio,
      // and pulling the editor panels into the test graph made v8 count their
      // functions for the first time — NodeConfigPanel alone sits at ~9% of
      // roughly a hundred. Nothing regressed: statements, branches and lines
      // all rose in the same change. NodeConfigPanel is the remaining mountain
      // and is best climbed alongside the editor redesign that will rewrite it.
      //
      // 2026-10-26: raised to just under 72.3 / 77.1 / 71.0 / 72.3. The floor
      // had drifted ~14 points below the real numbers, so it would have let
      // a large drop through. node-config-renders.test.tsx now renders every
      // palette node's panel (NodeConfigPanel lines 43% → 68%); functions
      // there stay low because rendering doesn't fire the handlers.
      thresholds: {
        statements: 71,
        branches: 76,
        functions: 70,
        lines: 71,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
