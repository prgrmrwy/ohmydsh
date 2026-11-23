import { defineConfig } from 'vitest/config'

/**
 * Browser suite (`npm run test:browser`): headless Chrome driven over the
 * DevTools protocol against the BUILT plugin (lib/), see test/browser/harness.ts.
 * A missing Chrome (DSHLS_CHROME) must fail, never skip.
 */
export default defineConfig({
  test: {
    include: ['test/browser/**/*.browser.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
