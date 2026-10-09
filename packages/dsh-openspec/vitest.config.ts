import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Several suites stage the real pinned official package (and hash its dependency closure) more than
    // once per test, so vitest's 5s default is not a meaningful budget here. Sibling local packages use
    // the same 30s ceiling.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
