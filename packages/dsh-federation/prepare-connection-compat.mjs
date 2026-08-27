#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { buildConnectionCompat } from '../../scripts/build-rc2-connection-compat.mjs'

const PACKAGE = path.dirname(fileURLToPath(import.meta.url))
const GENERATED = path.join(PACKAGE, '.generated', 'connection-compat')
const OUTPUT = path.join(PACKAGE, 'lib', 'connection')
const RUNTIME = path.join(OUTPUT, 'lib')
const MODULE_ID = '@deepseek-ai/dsh-client-connection'

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr = []
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code ?? signal}: ${Buffer.concat(stderr).toString('utf8').trim()}`))
    })
  })
}

/**
 * Build the fixed-source patched rc.2 Connection as a dual-face compatibility
 * artifact owned by the federation package. Sync installs it under the official
 * package identity in the same profile transaction as its owner, so the existing
 * `connection` row and browser module graph stay unchanged. Disabling federation
 * removes that direct profile override and restores install-anchor resolution.
 */
export async function prepareConnectionCompat() {
  const fixed = await buildConnectionCompat({ outputDir: GENERATED })
  const esbuildVersion = JSON.parse(await readFile(path.resolve(PACKAGE, '../../node_modules/esbuild/package.json'), 'utf8')).version
  const typescriptVersion = JSON.parse(await readFile(path.resolve(PACKAGE, '../../node_modules/typescript/package.json'), 'utf8')).version
  await rm(OUTPUT, { recursive: true, force: true })
  await mkdir(RUNTIME, { recursive: true })

  await build({
    absWorkingDir: GENERATED,
    entryPoints: ['src/index.ts'],
    outfile: path.join(RUNTIME, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node22'],
    packages: 'external',
    sourcemap: true,
    legalComments: 'none',
  })

  await build({
    absWorkingDir: GENERATED,
    entryPoints: ['src/invariant.ts'],
    outfile: path.join(RUNTIME, 'invariant.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node22'],
    packages: 'external',
    sourcemap: true,
    legalComments: 'none',
  })

  await build({
    absWorkingDir: GENERATED,
    entryPoints: ['src/client/index.ts'],
    outfile: path.join(RUNTIME, 'client.js'),
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: ['chrome120'],
    // The official rc.2 Connection browser artifact is self-contained and its
    // dsh.client declaration injects no module dependencies. Keep that contract:
    // externalizing runtime imports would emit require() calls that the browser
    // module graph has no rows to satisfy.
    sourcemap: true,
    legalComments: 'none',
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(MODULE_ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: { js: 'return module.exports; } });' },
  })

  await run(path.resolve(PACKAGE, '../../node_modules/.bin/tsc'), [
    '--declaration', '--emitDeclarationOnly', '--noCheck',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023',
    '--allowImportingTsExtensions', '--rootDir', path.join(GENERATED, 'src'),
    '--outDir', path.join(RUNTIME, 'types'),
    path.join(GENERATED, 'src/index.ts'),
    path.join(GENERATED, 'src/invariant.ts'),
    path.join(GENERATED, 'src/client/index.ts'),
  ], PACKAGE)

  const metadata = {
    name: '@deepseek-ai/dsh-client-connection',
    description: 'Wire consumer layer: HTTP-up/WebSocket-down client, ConnectionController dual streams with reconnect, and fixture api',
    version: '0.1.1-rc.2',
    private: true,
    publishConfig: { access: 'public' },
    repository: {
      type: 'git',
      url: 'git+https://github.com/deepseek-ai/deepseek-harness.git',
      directory: 'packages/client/connection',
    },
    type: 'module',
    main: 'lib/index.js',
    types: 'lib/types/index.d.ts',
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' },
      './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' },
      './src/*': './src/*',
      './package.json': './package.json',
    },
    dsh: { client: { inject: [], platform: 'web', immediately: true } },
    license: 'MIT',
    dependencies: {
      '@deepseek-ai/schemastery': '^3.18.1',
      ws: '^8.21.0',
    },
    files: [
      'lib/index.js',
      'lib/invariant.js',
      'lib/client.js',
      'lib/types/**/*.d.ts',
      'src',
      'LICENSE',
    ],
    peerDependencies: {
      '@deepseek-ai/dsh-host-webserver': '^0.1.1-rc.2',
      '@deepseek-ai/dsh-invariants': '^0.1.1-rc.2',
      '@deepseek-ai/cordis': '^4.0.1',
      '@deepseek-ai/dsh-host-apiproxy': '^0.1.1-rc.2',
      '@deepseek-ai/dsh-commands': '^0.1.1-rc.2',
      '@deepseek-ai/dsh-llm': '^0.1.1-rc.2',
      '@deepseek-ai/dsh-session': '^0.1.1-rc.2',
      '@deepseek-ai/dsh-tools': '^0.1.1-rc.2',
      '@deepseek-ai/dsh-attachment': '^0.1.1-rc.2',
    },
    federationProvenance: {
      dshVersion: '0.1.1-rc.2',
      releaseCommit: fixed.releaseCommit,
      patchSha256: fixed.patchSha256,
      toolchain: {
        node: process.version,
        esbuild: esbuildVersion,
        typescript: typescriptVersion,
      },
    },
  }
  await writeFile(path.join(OUTPUT, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  await cp(path.join(GENERATED, 'src'), path.join(OUTPUT, 'src'), { recursive: true })
  await cp(path.join(GENERATED, 'LICENSE'), path.join(OUTPUT, 'LICENSE'))

  // Sanity check every published runtime face is non-empty before package
  // deployment can replace a last-known-good local package.
  for (const file of ['lib/index.js', 'lib/invariant.js', 'lib/client.js', 'lib/types/index.d.ts', 'LICENSE']) {
    if ((await readFile(path.join(OUTPUT, file))).byteLength === 0) throw new Error(`empty Connection artifact: ${file}`)
  }
  return { outputDir: OUTPUT, ...fixed }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareConnectionCompat().then(result => {
    process.stdout.write(`[dsh-federation] connection compat ${result.patchSha256}\n`)
  }).catch(error => {
    console.error(`[dsh-federation] connection compat failed before deployment: ${error.message}`)
    process.exitCode = 1
  })
}
