import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Client tests render the settings page, so the JSX runtime must match the
  // client build (automatic) rather than esbuild's classic default.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // The change adds tests alongside each module; until the first module lands
    // there is nothing to collect, which must not fail the package's `test` script.
    passWithNoTests: true,
  },
})
