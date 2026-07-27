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
      thresholds: {
        statements: 54,
        branches: 73,
        functions: 78,
        lines: 54,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
