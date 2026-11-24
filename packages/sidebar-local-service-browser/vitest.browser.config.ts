import { defineConfig } from 'vitest/config'
import { dshlsAssetsPlugin } from './tsdown.config.ts'

/**
 * Browser suite (`npm run test:browser`): headless Chrome driven over the
 * DevTools protocol against the BUILT plugin (lib/), see test/browser/harness.ts.
 * A missing Chrome (DSHLS_CHROME) must fail, never skip.
 */
export default defineConfig({
  // Resolves virtual:dshls/* for the Host source the harness loads (strict: a missing entry fails).
  plugins: [dshlsAssetsPlugin({ allowPlaceholder: false })],
  test: {
    include: ['test/browser/**/*.browser.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
