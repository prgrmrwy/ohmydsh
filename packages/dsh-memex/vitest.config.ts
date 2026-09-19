import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The change adds tests alongside each module; until the first module lands
    // there is nothing to collect, which must not fail the package's `test` script.
    passWithNoTests: true,
  },
})
