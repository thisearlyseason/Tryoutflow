import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Uses the repository's existing test tooling; native services are replaced only at the boundary.
export default defineConfig({
  resolve: {
    alias: { react: fileURLToPath(new URL('../../node_modules/react', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['apps/mobile/tests/**/*.test.tsx'],
  },
});
