import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Loads the artifacts DSH actually deploys.
 *
 * `federation-package-build.test.mjs` asserts on the *text* of
 * `lib/client.js` and never executes it, and the built host entry
 * (`lib/index.js`, the package `main`) is not exercised at all. A bundle that
 * builds but cannot load would pass every other test in this repository, so
 * this test loads both real artifacts the way DSH does.
 *
 * Nothing is deployed and `~/.dsh` is never touched.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

async function ensureBuilt() {
  try {
    await stat(path.join(PKG, 'lib/client.js'))
    await stat(path.join(PKG, 'lib/index.js'))
  } catch {
    const built = spawnSync('npm', ['run', 'build', '--workspace', 'dsh-federation'], { cwd: REPO, encoding: 'utf8' })
    assert.equal(built.status, 0, built.stderr)
  }
}

test('the built host entry loads and stays inert under a real Cordis context', { timeout: 180_000 }, async () => {
  await ensureBuilt()
  const { Context } = await import('@deepseek-ai/cordis')
  const entry = path.join(PKG, 'lib/index.js')
  const mod = await import(`${pathToFileURL(entry).href}?v=${Date.now()}`)

  // The manifest declares this as the package main; DSH imports it directly.
  const pkg = JSON.parse(await readFile(path.join(PKG, 'package.json'), 'utf8'))
  assert.equal(pkg.main, './lib/index.js')
  assert.equal(mod.name, 'dsh-federation')
  assert.deepEqual(mod.inject, ['webServer', 'connection'])
  assert.equal(typeof mod.apply, 'function')

  // The public surface the rest of the system consumes must be reachable from
  // the built artifact, not just from TypeScript sources.
  for (const exported of [
    'encodeSessionId', 'decodeSessionId', 'CommandRouter', 'NodeRegistryModel',
    'WriteLedger', 'NodeReconciler', 'aggregateProjection', 'parseNodeId',
    'HttpUnaryCarrier', 'DualEventCarrier', 'DshRc2NodeAdapter', 'CentralUplink',
    'HostActivationCoordinator', 'OpenSshTunnelManager', 'NodeRegistryStorage',
    'RC2_ALLOWED_METHODS', 'RC2_FORBIDDEN_METHODS',
  ]) {
    assert.ok(mod[exported] !== undefined, `built host entry is missing ${exported}`)
  }

  // Forbidden rc.2 surfaces must stay unreachable in the shipped artifact.
  for (const method of mod.RC2_FORBIDDEN_METHODS) {
    assert.equal(mod.RC2_ALLOWED_METHODS.has(method), false, `${method} must not be callable`)
  }

  // M1 ships inert: applying it must register nothing and throw nothing.
  const ctx = new Context()
  ctx.provide('webServer', undefined, true)
  const registrations = []
  ctx.webServer = {
    register(route) { registrations.push(route.path); return () => {} },
    registerUpgrade(route) { registrations.push(route.path); return () => {} },
  }
  mod.apply(ctx)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.deepEqual(registrations, [], 'the disabled package must not claim any route')

  // The built core must actually work, not merely be importable.
  const id = mod.encodeSessionId({ nodeId: mod.parseNodeId('vm-a'), nativeId: 'shared' })
  assert.match(id, /^fed1:vm-a:s:/)
  assert.equal(mod.decodeSessionId(id, new Set([mod.parseNodeId('vm-a')])).nativeId, 'shared')
})

test('the built client bundle evaluates in a browser-like context and registers its module', { timeout: 180_000 }, async () => {
  await ensureBuilt()
  const source = await readFile(path.join(PKG, 'lib/client.js'), 'utf8')

  // DSH serves this file to the browser, where it self-registers with the
  // ModuleLoader. Evaluate it with a stubbed loader and DOM.
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:3080/',
    runScripts: 'outside-only',
  })
  // The real bundle calls `load({ id, factory: (require) => … })`, builds its
  // own module object and resolves peers through the injected `require`.
  // Real browsers expose these; JSDOM omits some, so provide the standard
  // globals the bundle legitimately relies on (TextEncoder/TextDecoder, btoa).
  for (const [key, value] of Object.entries({
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
  })) {
    if (dom.window[key] === undefined) dom.window[key] = value
  }

  const loaded = []
  const requested = []
  const peers = {
    react: { createElement: () => null, Fragment: Symbol('fragment'), useState: () => [undefined, () => {}], useEffect: () => {}, useMemo: fn => fn(), useRef: () => ({ current: undefined }) },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('fragment') },
    clsx: (...args) => args.filter(Boolean).join(' '),
    '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, { get: () => () => null }),
    '@deepseek-ai/dsh-client-runtime/client': {
      abbreviateHomePath: value => value,
      indexSubagentDescendants: () => new Map(),
      defineStore: spec => ({ spec, create: () => ({ actions: {}, getSnapshot: () => spec.init?.() ?? {}, subscribe: () => () => {} }) }),
    },
  }
  dom.window.__ModuleLoader__ = {
    load(descriptor) {
      loaded.push(descriptor)
      const resolve = specifier => {
        requested.push(specifier)
        const peer = peers[specifier]
        assert.ok(peer !== undefined, `bundle required an unexpected peer: ${specifier}`)
        return peer
      }
      // Evaluating the factory is the point: a broken bundle throws here.
      return descriptor.factory(resolve)
    },
  }

  assert.doesNotThrow(() => {
    dom.window.eval(source)
  }, 'the shipped client bundle must evaluate without throwing')

  assert.equal(loaded.length, 1, `expected exactly one ModuleLoader registration, got ${loaded.length}`)
  assert.equal(loaded[0].id, 'dsh-federation')

  // The bundle owns its CSS injection: DSH-owned style tag, no separate file.
  const styles = [...dom.window.document.querySelectorAll('style')]
  const owned = styles.filter(tag => tag.dataset.plugin === 'dsh-federation')
  assert.ok(owned.length >= 1, 'the bundle must inject its own DSH-owned style tag')
  assert.equal(owned[0].dataset.pluginCss, 'dsh-federation/workspace-embed.css')
  assert.ok(owned[0].textContent.length > 0, 'the injected stylesheet must not be empty')
  await assert.rejects(stat(path.join(PKG, 'lib/client.css')), /ENOENT/,
    'no sidecar CSS file may ship alongside the bundle')

  dom.window.close()
})
