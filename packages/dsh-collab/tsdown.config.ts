import { defineConfig } from 'tsdown'
import { copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  dts: true,
  sourcemap: false,
  unbundle: false,
  alias: { 'collab-kernel': fileURLToPath(new URL('../collab-kernel/src/index.ts', import.meta.url)) },
  deps: { neverBundle: [/^@deepseek-ai\//], alwaysBundle: ['collab-kernel'] },
  outputOptions: { codeSplitting: false, entryFileNames: '[name].js' },
  hooks: { 'build:done': async () => {
    await copyFile(new URL('../collab-kernel/src/convention/v1.md', import.meta.url), new URL('./lib/v1.md', import.meta.url))
    await copyFile(new URL('./src/cli.mjs', import.meta.url), new URL('./lib/salvage.mjs', import.meta.url))
  } },
})
