import { defineConfig } from 'vitest/config'
import { dshlsAssetsPlugin } from './tsdown.config.ts'

/**
 * Node suite (`npm test`): Host tests, harness smoke, jsdom tab tests.
 * Browser-driven suites live in test/browser and run via vitest.browser.config.ts.
 * Tests always tolerate a missing inject/sw entry (placeholder) so Host tests
 * stay runnable while the browser half is being written; production builds do not.
 */
export default defineConfig({
  plugins: [dshlsAssetsPlugin({ allowPlaceholder: true })],
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/browser/**', 'node_modules/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
