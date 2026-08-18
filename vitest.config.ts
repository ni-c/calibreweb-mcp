import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Entry point: only wires config and server to the stdio transport and exits
      // the process; not reachable from unit tests.
      exclude: ['src/index.ts'],
      // Measured 2026-08-19 at 95.27 / 86.85 / 98.64 / 96.74 (vitest 4, v8).
      // Set just below the actual values with headroom on functions — write the
      // missing tests instead of lowering them.
      thresholds: {
        statements: 94,
        branches: 85,
        functions: 94,
        lines: 95,
      },
    },
  },
});
