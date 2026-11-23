import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { rolldown } from 'rolldown'
import { defineConfig } from 'tsdown'

/**
 * Three bundles come out of this package:
 *
 *  - `lib/index.js`   Host entry (ESM, Node). The Service Worker script and the
 *                     injected page script are inlined into it as strings, see below.
 *  - `lib/client.js`  better-sidebar tab (CJS wrapped for the DSH module loader).
 *  - (inline only)    `src/sw/index.ts` and `src/inject/index.ts` are bundled to
 *                     self-contained minified IIFEs and exposed to Host code as the
 *                     virtual modules `virtual:dshls/sw` / `virtual:dshls/inject`
 *                     (default export: the script text). The same plugin is used by
 *                     vitest.config.ts so tests exercise the exact production path.
 */

/** Virtual module id → browser-side source entry (relative to the package root). */
export const ASSET_ENTRIES: Readonly<Record<string, string>> = {
  'virtual:dshls/inject': 'src/inject/index.ts',
  'virtual:dshls/sw': 'src/sw/index.ts',
}

/**
 * SCAFFOLD PHASE ONLY. While src/inject and src/sw have not been written yet a
 * placeholder script may stand in so the Host side can be built and tested.
 * A placeholder must never reach a release artifact: once both entries exist
 * flip this to `false` so a missing entry fails the build by default.
 * `DSHLS_REQUIRE_ASSETS=1` forces strict mode regardless of this flag.
 */
const ALLOW_PLACEHOLDER_ASSETS_BY_DEFAULT = false

const packageRoot = process.cwd()

async function bundleBrowserScript(entry: string): Promise<string> {
  const bundle = await rolldown({ input: entry, platform: 'browser', logLevel: 'warn' })
  try {
    const { output } = await bundle.generate({ format: 'iife', minify: true })
    const chunk = output.find((item) => item.type === 'chunk')
    if (chunk === undefined) throw new Error(`dshls assets: ${entry} produced no chunk`)
    return chunk.code
  } finally {
    await bundle.close()
  }
}

export interface AssetsPluginOptions {
  /** Missing entry → placeholder script instead of a build error. */
  allowPlaceholder: boolean
  /** Package root used to resolve ASSET_ENTRIES. */
  root?: string
}

/** Rolldown/Vite plugin resolving `virtual:dshls/*` to bundled script text. */
export function dshlsAssetsPlugin(options: AssetsPluginOptions) {
  const root = options.root ?? packageRoot
  return {
    name: 'dshls-assets',
    resolveId(id: string) {
      return id in ASSET_ENTRIES ? `\0${id}` : undefined
    },
    async load(id: string) {
      if (!id.startsWith('\0') || !(id.slice(1) in ASSET_ENTRIES)) return undefined
      const virtualId = id.slice(1)
      const entry = resolve(root, ASSET_ENTRIES[virtualId] as string)
      let code: string
      if (existsSync(entry)) {
        code = await bundleBrowserScript(entry)
      } else if (options.allowPlaceholder) {
        console.warn(`[dshls-assets] ${entry} is missing: using a PLACEHOLDER for ${virtualId} (scaffold phase only, never ship)`)
        code = `/* dshls placeholder for ${virtualId}: source entry missing */`
      } else {
        throw new Error(`dshls assets: ${entry} is missing; refusing to build ${virtualId} without it`)
      }
      return `export default ${JSON.stringify(code)}`
    },
  }
}

const strictAssets = process.env.DSHLS_REQUIRE_ASSETS === '1' || !ALLOW_PLACEHOLDER_ASSETS_BY_DEFAULT

const clientEntry = resolve(packageRoot, 'src/client/index.tsx')
const clientExternal = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'dsh-better-sidebar']

const host = {
  name: 'dsh-sidebar-local-service-browser/host',
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm' as const,
  platform: 'node' as const,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: { neverBundle: [/^node:/, /^@deepseek-ai\//] },
  plugins: [dshlsAssetsPlugin({ allowPlaceholder: !strictAssets })],
  outputOptions: { entryFileNames: 'index.js' },
}

const client = {
  name: 'dsh-sidebar-local-service-browser/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs' as const,
  platform: 'browser' as const,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: clientExternal,
    alwaysBundle: (id: string) => (clientExternal.includes(id) ? undefined : true),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-sidebar-local-service-browser", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

let includeClient = existsSync(clientEntry)
if (!includeClient) {
  // vitest.config.ts imports this file only for the assets plugin: stay quiet and never throw there.
  if (process.env.VITEST === undefined) {
    if (strictAssets) throw new Error(`dshls build: ${clientEntry} is missing`)
    console.warn(`[dshls-build] ${clientEntry} is missing: client bundle skipped (scaffold phase only, never ship)`)
  }
}

export default defineConfig(includeClient ? [host, client] : [host])
