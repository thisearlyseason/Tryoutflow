import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    // Integration files share one deliberately guarded local PostgreSQL schema. Running files in
    // parallel lets global queue claims and schema snapshots observe another file's transient
    // fixtures even though separate command processes are serialized by the outer runner.
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/{integration,contract}/**/*.test.{ts,tsx}'],
  },
});
