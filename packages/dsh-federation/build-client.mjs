#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { prepareWorkspaceEmbed } from './prepare-workspace-embed.mjs'

const PACKAGE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(PACKAGE, 'lib')
const JS = path.join(OUT, 'client.js')
const CSS = path.join(OUT, 'client.css')
const PLUGIN_ID = 'dsh-federation'
const external = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  'clsx',
]

await prepareWorkspaceEmbed()
await mkdir(OUT, { recursive: true })
await build({
  absWorkingDir: PACKAGE,
  entryPoints: ['src/client/index.ts'],
  outfile: JS,
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: ['chrome120'],
  jsx: 'automatic',
  loader: { '.css': 'local-css' },
  external,
  sourcemap: true,
  legalComments: 'none',
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

const css = await readFile(CSS, 'utf8')
const js = await readFile(JS, 'utf8')
const cssTagId = `${PLUGIN_ID}/workspace-embed.css`
const inject = `\nif (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(${JSON.stringify(cssTagId)}) + "]") === null) {\n  const tag = document.createElement("style");\n  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};\n  tag.dataset.pluginCss = ${JSON.stringify(cssTagId)};\n  tag.textContent = ${JSON.stringify(css)};\n  document.head.appendChild(tag);\n}\n`
const footer = 'return module.exports; } });'
const footerOffset = js.lastIndexOf(footer)
if (footerOffset === -1) throw new Error('unexpected esbuild wrapper footer')
await writeFile(JS, `${js.slice(0, footerOffset)}${inject}${js.slice(footerOffset)}`)
await rm(CSS, { force: true })
await rm(`${CSS}.map`, { force: true })
