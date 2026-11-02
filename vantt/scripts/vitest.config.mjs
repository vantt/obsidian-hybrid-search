// Tests of the fork scripts (PRD 11.2). Run from the repo root:
//   npx vitest run --config vantt/scripts/vitest.config.mjs
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/**/*.test.mjs'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
