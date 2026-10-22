import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Vendored brand SVGs must reach the code as markup, as tsdown's text loader
  // delivers them in production; Vite's default 4 KB limit would turn larger
  // marks (magpie.svg, ~4.9 KB) into a URL string under test.
  build: { assetsInlineLimit: 16 * 1024 },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
