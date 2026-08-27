import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import React from 'react'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The browser entry must actually contribute slots.
 *
 * `src/client/index.ts` was an inert stub while task 6.8 was marked complete, so
 * enabling the package would have rendered no federated UI. This test drives the
 * real `apply()` against the real rc.2 `SlotCore` and pins the conservative
 * rule: no bridge, or a not-ready bridge, leaves the official entries winning.
 *
 * Nothing touches `~/.dsh`.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

const OfficialSidebar = () => null
const OfficialHero = () => null

/** A SlotCore shaped like the official shell: parent declares both holes. */
function officialSlots() {
  const slots = new SlotCore()
  slots.register({
    name: 'root',
    children: {
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
    },
    registrant: 'official-shell',
  }, () => null)
  slots.register({ name: 'sidebar.workspaces', registrant: 'official-workspace' }, OfficialSidebar)
  slots.register({ name: 'conversation.hero.workspace', registrant: 'official-workspace' }, OfficialHero)
  return slots
}

const winner = (slots, name) => slots.entriesOfSlot(name)[0]?.component

/** Minimal ClientContext surface the entry consumes. */
function fakeClientContext(slots) {
  const disposers = []
  return {
    slots: {
      register: (descriptor, component) => slots.register(descriptor, component),
      onEntryError: listener => slots.onEntryError(listener),
      entries: name => slots.entries(name),
      subscribe: (name, listener) => slots.subscribe(name, listener),
    },
    effect(install, _label) {
      const dispose = install()
      disposers.push(dispose)
      return dispose
    },
    disposeAll() {
      for (const dispose of disposers.reverse()) dispose?.()
    },
  }
}

async function writeStubs(root) {
  const primitives = path.join(root, 'primitives.mjs')
  await writeFile(primitives, `
import React from 'react'
const icon = props => React.createElement('span', props)
export const IconArchiveOutline20 = icon
export const IconBranchOutline16 = icon
export const IconCloseFill14 = icon
export const IconEditOutline16 = icon
export const IconEllipsisOutline16 = icon
export const IconFolderClose16 = icon
export const IconFolderOpen16 = icon
export const IconPersonalizationOutline16 = icon
export const IconPlusOutline16 = icon
export const IconProjectAddOutline16 = icon
export const IconSearchOutline16 = icon
export const IconTrashOutline16 = icon
export const IconTriangleRightFill14 = icon
export const Button = ({ children, ...rest }) => React.createElement('button', rest, children)
export const StateDot = () => null
export const Tooltip = ({ children }) => children
export const HoverCard = ({ anchor }) => anchor
export const Menu = ({ anchor }) => anchor
export const Modal = () => null
`)
  const runtime = path.join(root, 'runtime.mjs')
  await writeFile(runtime, `
export const abbreviateHomePath = value => value
export const indexSubagentDescendants = () => new Map()
export function defineStore(spec) {
  return {
    spec,
    create() {
      let state = spec.init()
      const listeners = new Set()
      const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, mutate]) => [name, (...args) => {
        mutate(state, ...args)
        for (const listener of listeners) listener()
      }]))
      return {
        actions,
        getSnapshot: () => state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        clearPersisted() {},
        store: { getSnapshot: () => state, subscribe: () => () => {}, update() {}, set() {} },
      }
    },
  }
}
`)
  return { primitives, runtime }
}

async function loadClientEntryFull(root) {
  const stubs = await writeStubs(root)
  const entry = path.join(root, 'entry-full.ts')
  await writeFile(entry, `export * from ${JSON.stringify(path.join(PKG, 'src/client/index.ts'))}\n`)
  const bundle = path.join(REPO, 'node_modules/.cache', `federation-client-full-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  const built = spawnSync(path.join(REPO, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node', '--jsx=automatic',
    '--loader:.css=local-css', `--outfile=${bundle}`, '--log-level=error',
    '--external:react', '--external:react/jsx-runtime', '--external:react-dom',
    '--external:@deepseek-ai/dsh-client-ui-slots', '--external:clsx',
    `--alias:@deepseek-ai/dsh-client-ui-primitives=${stubs.primitives}`,
    `--alias:@deepseek-ai/dsh-client-runtime/client=${stubs.runtime}`,
  ], { encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)
  const mod = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)
  return { mod, bundle }
}

async function loadClientEntry(root) {
  const stubs = await writeStubs(root)
  const entry = path.join(root, 'entry.ts')
  // Export the full client surface so the default-bridge path in `apply()` is
  // exercised too, not only the injectable-bridge seam.
  await writeFile(entry, [
    `export * from ${JSON.stringify(path.join(PKG, 'src/client/entry.tsx'))}`,
    `export * from ${JSON.stringify(path.join(PKG, 'src/client/bridge.ts'))}`,
    '',
  ].join('\n'))
  // Emit inside the repo so externalised peers (react, rc.2 packages) resolve.
  const bundle = path.join(REPO, 'node_modules/.cache', `federation-client-entry-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  const built = spawnSync(path.join(REPO, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node', '--jsx=automatic',
    '--loader:.css=local-css', `--outfile=${bundle}`, '--log-level=error',
    '--external:react', '--external:react/jsx-runtime', '--external:react-dom',
    '--external:@deepseek-ai/dsh-client-ui-slots', '--external:clsx',
    // The rc.2 UI packages are not repo dependencies; alias them to stubs, as
    // the other federation UI tests do. Only shape matters here.
    `--alias:@deepseek-ai/dsh-client-ui-primitives=${stubs.primitives}`,
    `--alias:@deepseek-ai/dsh-client-runtime/client=${stubs.runtime}`,
  ], { encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)
  const mod = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)
  return { mod, bundle }
}

/** A bridge exposing one local node with a complete binding. */
function readyBridge() {
  const hook = snapshot => selector => selector(snapshot)
  return {
    ready: () => true,
    nodes: () => [{
      nodeId: 'this-mac', displayName: 'This Mac', kind: 'local', enabled: true, order: 0,
      state: 'READY', compatibility: 'SUPPORTED', runningSessionCount: 0, pendingInteractionCount: 0,
      home: '/synthetic',
    }],
    bindingFor: () => ({
      useSessions: hook({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }),
      useWorkspaces: hook({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true }),
      useStore: undefined,
      actions: undefined,
      startSession: () => {},
      open: () => {},
      renameSession: async () => {},
      forkSession: () => {},
      renameWorkspace: async () => {},
      deleteWorkspace: async () => {},
      insertWorkspaceBefore: async () => {},
      archiveSession: async () => {},
      insertSessionBefore: async () => {},
      t: key => key,
    }),
  }
}

test('the browser entry leaves official slots alone without a ready bridge', { timeout: 240_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-client-entry-'))
  const bundles = []
  try {
    const { mod, bundle } = await loadClientEntry(root)
    bundles.push(bundle)

    // Case A: no bridge at all — the deployed-but-inactive package. It must not
    // even attempt activation: no slot registration and no entry-error listener,
    // so the official surfaces are untouched by construction rather than by a
    // failed attempt.
    const noBridge = officialSlots()
    let registerCalls = 0
    let errorListeners = 0
    const inertCtx = fakeClientContext(noBridge)
    const inertSlots = inertCtx.slots
    inertCtx.slots = {
      ...inertSlots,
      register: (descriptor, component) => { registerCalls++; return inertSlots.register(descriptor, component) },
      onEntryError: listener => { errorListeners++; return inertSlots.onEntryError(listener) },
    }
    mod.applyFederationClient(inertCtx, {})
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(registerCalls, 0, 'no bridge must mean no slot registration attempt at all')
    assert.equal(errorListeners, 0, 'no bridge must mean no entry-error subscription')
    assert.equal(winner(noBridge, 'sidebar.workspaces'), OfficialSidebar)
    assert.equal(winner(noBridge, 'conversation.hero.workspace'), OfficialHero)
    assert.equal(noBridge.entries('sidebar.workspaces').length, 1,
      'no federation entry may be registered without a bridge')

    // Case B: a bridge that is not ready yet.
    const notReady = officialSlots()
    // A bridge that is otherwise complete but reports not-ready: every node has
    // a binding, so only the readiness gate can stop activation here.
    const bridge = { ...readyBridge(), ready: () => false }
    mod.applyFederationClient(fakeClientContext(notReady), { bridge, clientId: 'tab-not-ready' })
    for (let attempt = 0; attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(winner(notReady, 'sidebar.workspaces'), OfficialSidebar,
      'a not-ready bridge must not shadow the official sidebar')
    assert.equal(notReady.entries('sidebar.workspaces').length, 1)
    assert.equal(notReady.entries('conversation.hero.workspace').length, 1,
      'the hero surface must stay official too')

    // Case C: a ready bridge whose node has no binding must also fail closed.
    const missingBinding = officialSlots()
    mod.applyFederationClient(fakeClientContext(missingBinding), {
      bridge: { ...readyBridge(), bindingFor: () => undefined },
      clientId: 'tab-missing-binding',
    })
    for (let attempt = 0; attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(winner(missingBinding, 'sidebar.workspaces'), OfficialSidebar,
      'an incomplete binding must not shadow the official sidebar')
  } finally {
    for (const bundle of bundles) {
      await rm(bundle, { force: true })
      // esbuild emits a CSS sidecar for the embed's stylesheets.
      await rm(bundle.replace(/\.mjs$/, '.css'), { force: true })
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('a ready bridge shadows both official surfaces and abdicates cleanly', { timeout: 240_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-client-entry-active-'))
  const bundles = []
  try {
    const { mod, bundle } = await loadClientEntry(root)
    bundles.push(bundle)
    const slots = officialSlots()
    const ctx = fakeClientContext(slots)
    mod.applyFederationClient(ctx, { bridge: readyBridge(), clientId: 'tab-active' })

    for (let attempt = 0; attempt < 80 && winner(slots, 'sidebar.workspaces') === OfficialSidebar; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.notEqual(winner(slots, 'sidebar.workspaces'), OfficialSidebar,
      'a ready bridge must shadow the official sidebar')
    assert.notEqual(winner(slots, 'conversation.hero.workspace'), OfficialHero,
      'a ready bridge must shadow the official hero picker')
    assert.equal(slots.entries('sidebar.workspaces').length, 2,
      'exactly one federation entry plus the official entry')

    // Real abdication: SlotCore demotes the crashing entry, and the controller
    // must dispose BOTH federation surfaces for this browser.
    const entry = slots.entriesOfSlot('sidebar.workspaces')[0]
    slots.reportEntryError('sidebar.workspaces', entry, new Error('render failed'), { abdicate: true })
    assert.equal(winner(slots, 'sidebar.workspaces'), OfficialSidebar)
    assert.equal(winner(slots, 'conversation.hero.workspace'), OfficialHero,
      'the sibling federation surface must be disposed too')

    ctx.disposeAll()
    assert.equal(slots.entries('sidebar.workspaces').length, 1,
      'disposal must leave only the official entry')
  } finally {
    for (const bundle of bundles) {
      await rm(bundle, { force: true })
      // esbuild emits a CSS sidecar for the embed's stylesheets.
      await rm(bundle.replace(/\.mjs$/, '.css'), { force: true })
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('the default bridge path activates from Host-published nodes (no injected bridge)', { timeout: 240_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-client-default-'))
  const bundles = []
  try {
    const { mod, bundle } = await loadClientEntryFull(root)
    bundles.push(bundle)
    const slots = officialSlots()

    // A ClientContext shaped like the real one: `connection.rpc` is the generic
    // channel, and sessions/workspaces are the official client stores.
    const store = snapshot => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
    const calls = []
    const ctx = {
      ...fakeClientContext(slots),
      get: name => (name === 'connection'
        ? {
          rpc: {
            call: async (channel, endpoint) => {
              calls.push(`${channel}:${endpoint}`)
              return { ok: true, value: { nodes: [{
                nodeId: 'this-mac', displayName: 'This Mac', kind: 'local', enabled: true, order: 0,
                state: 'READY', compatibility: 'SUPPORTED', runningSessionCount: 0, pendingInteractionCount: 0,
                home: '/synthetic',
              }] } }
            },
          },
        }
        : undefined),
      sessions: {
        list: store({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }),
        open: () => {},
        fork: async () => 'child',
        binding: () => ({ session: { rename: async () => ({ ok: true }) } }),
      },
      workspaces: {
        list: store({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true }),
        startSession: () => {},
        rename: async () => {},
        delete: async () => {},
        insertBefore: async () => {},
        archiveSession: async () => {},
        insertSessionBefore: async () => {},
      },
      locale: { bind: () => key => key },
    }

    // No bridge is injected: apply() must build one from ctx.connection.rpc.
    mod.apply(ctx, undefined)
    for (let attempt = 0; attempt < 120 && winner(slots, 'sidebar.workspaces') === OfficialSidebar; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    assert.ok(calls.includes('/api:federation/nodes'),
      `the default bridge must query the Host: ${JSON.stringify(calls)}`)
    assert.notEqual(winner(slots, 'sidebar.workspaces'), OfficialSidebar,
      'a YAML-loaded plugin must be able to activate without an injected bridge')
    assert.notEqual(winner(slots, 'conversation.hero.workspace'), OfficialHero)
  } finally {
    for (const bundle of bundles) {
      await rm(bundle, { force: true })
      await rm(bundle.replace(/\.mjs$/, '.css'), { force: true })
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('a remote node activates once its baseline is installed', { timeout: 240_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-client-remote-'))
  const bundles = []
  try {
    const { mod, bundle } = await loadClientEntryFull(root)
    bundles.push(bundle)
    const slots = officialSlots()
    const store = snapshot => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })

    const wid = `fed1:vm-a:w:${Buffer.from('shared').toString('base64url')}`
    const sidRemote = `fed1:vm-a:s:${Buffer.from('shared').toString('base64url')}`
    const endpoints = []
    const ctx = {
      ...fakeClientContext(slots),
      get: name => (name === 'connection'
        ? {
          rpc: {
            call: async (channel, endpoint, payload) => {
              endpoints.push(endpoint)
              if (endpoint === 'federation/nodes') {
                return { ok: true, value: { nodes: [{
                  nodeId: 'vm-a', displayName: 'VM A', kind: 'remote', enabled: true, order: 1,
                  state: 'READY', compatibility: 'SUPPORTED', runningSessionCount: 0,
                  pendingInteractionCount: 0, outcomeUnknownCount: 1, home: '/remote',
                }] } }
              }
              if (endpoint === 'federation/baseline') {
                assert.equal(payload.nodeId, 'vm-a', 'baseline must be requested per node')
                return { ok: true, value: {
                  workspaces: [{
                    workspaceId: wid, path: '/remote/project', title: 'shared-workspace',
                    sessionIds: [sidRemote], createdAt: 'x', updatedAt: 'y',
                  }],
                  sessions: [{
                    id: sidRemote, displayTitle: 'shared-session', cwd: '/remote/project',
                    running: false, blank: false, updatedAt: 1,
                  }],
                  archivedSessionIds: [],
                } }
              }
              return { ok: true, value: {} }
            },
          },
        }
        : undefined),
      sessions: { list: store({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }), open: () => {}, fork: async () => 'c', binding: () => ({ session: { rename: async () => ({ ok: true }) } }) },
      workspaces: { list: store({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true }), startSession: () => {}, rename: async () => {}, delete: async () => {}, insertBefore: async () => {}, archiveSession: async () => {}, insertSessionBefore: async () => {} },
      locale: { bind: () => key => key },
    }

    mod.apply(ctx, undefined)
    for (let attempt = 0; attempt < 160 && winner(slots, 'sidebar.workspaces') === OfficialSidebar; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    assert.ok(endpoints.includes('federation/baseline'),
      `a remote node must have its baseline hydrated: ${JSON.stringify(endpoints)}`)
    assert.notEqual(winner(slots, 'sidebar.workspaces'), OfficialSidebar,
      'a remote node with an installed baseline must activate the federated sidebar')
    assert.notEqual(winner(slots, 'conversation.hero.workspace'), OfficialHero)
    const { renderToStaticMarkup } = await import('react-dom/server')
    const SidebarComponent = slots.entriesOfSlot('sidebar.workspaces')[0].component
    const sidebarMarkup = renderToStaticMarkup(React.createElement(SidebarComponent))
    assert.match(sidebarMarkup, /data-federation-outcome-unknown="1"/)
    assert.match(sidebarMarkup, /manual review required/)

    // The hero surface must be the real federated picker, not a copy of the
    // sidebar subtree: render it and check its own markers.
    const HeroComponent = slots.entriesOfSlot('conversation.hero.workspace')[0].component
    const markup = renderToStaticMarkup(React.createElement(HeroComponent))
    assert.match(markup, /data-federation-hero-picker="true"/,
      'the hero slot must render the federated picker')
    assert.match(markup, /data-federation-picker-node="vm-a"/)
    assert.match(markup, /data-federation-directory-mode="browse"/,
      'a remote node must offer the in-app browse flow')
    assert.match(markup, new RegExp(`data-federation-picker-workspace="${wid}"`))
  } finally {
    for (const bundle of bundles) {
      await rm(bundle, { force: true })
      await rm(bundle.replace(/\.mjs$/, '.css'), { force: true })
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('a remote node whose baseline DTO is malformed keeps the browser official', { timeout: 240_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-client-remote-malformed-'))
  const bundles = []
  try {
    const { mod, bundle } = await loadClientEntryFull(root)
    bundles.push(bundle)
    const slots = officialSlots()
    const store = snapshot => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
    const ctx = {
      ...fakeClientContext(slots),
      get: name => (name === 'connection' ? { rpc: { call: async (_channel, endpoint) => endpoint === 'federation/nodes'
        ? { ok: true, value: { nodes: [{ nodeId: 'vm-a', displayName: 'VM A', kind: 'remote', enabled: true, order: 1, state: 'READY', compatibility: 'SUPPORTED', runningSessionCount: 0, pendingInteractionCount: 0 }] } }
        : { ok: true, value: { workspaces: [{ workspaceId: 'fed1:vm-b:w:b2xk', title: 'wrong owner', path: '/r', sessionIds: [], createdAt: 'x', updatedAt: 'y' }], sessions: [], archivedSessionIds: [] } },
      } } : undefined),
      sessions: { list: store({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }), open: () => {}, fork: async () => 'c', binding: () => ({ session: { rename: async () => ({ ok: true }) } }) },
      workspaces: { list: store({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true }), startSession: () => {}, rename: async () => {}, delete: async () => {}, insertBefore: async () => {}, archiveSession: async () => {}, insertSessionBefore: async () => {} },
      locale: { bind: () => key => key },
    }
    mod.apply(ctx, undefined)
    for (let attempt = 0; attempt < 160 && winner(slots, 'sidebar.workspaces') === OfficialSidebar; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(winner(slots, 'sidebar.workspaces'), OfficialSidebar)
    assert.equal(winner(slots, 'conversation.hero.workspace'), OfficialHero)
  } finally {
    for (const bundle of bundles) {
      await rm(bundle, { force: true })
      await rm(bundle.replace(/\.mjs$/, '.css'), { force: true })
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('a remote node whose baseline fails keeps the browser official', { timeout: 240_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-client-remote-fail-'))
  const bundles = []
  try {
    const { mod, bundle } = await loadClientEntryFull(root)
    bundles.push(bundle)
    const slots = officialSlots()
    const store = snapshot => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })

    const ctx = {
      ...fakeClientContext(slots),
      get: name => (name === 'connection'
        ? {
          rpc: {
            call: async (_channel, endpoint) => {
              if (endpoint === 'federation/nodes') {
                return { ok: true, value: { nodes: [{
                  nodeId: 'vm-down', displayName: 'VM down', kind: 'remote', enabled: true, order: 1,
                  state: 'READY', compatibility: 'SUPPORTED', runningSessionCount: 0, pendingInteractionCount: 0,
                }] } }
              }
              // The node is registered and enabled, but its baseline is not
              // available (tunnel down / node still connecting).
              if (endpoint === 'federation/baseline') return { ok: false, error: { message: 'tunnel down' } }
              return { ok: true, value: {} }
            },
          },
        }
        : undefined),
      sessions: { list: store({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }), open: () => {}, fork: async () => 'c', binding: () => undefined },
      workspaces: { list: store({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true }), startSession: () => {}, rename: async () => {}, delete: async () => {}, insertBefore: async () => {}, archiveSession: async () => {}, insertSessionBefore: async () => {} },
      locale: { bind: () => key => key },
    }

    mod.apply(ctx, undefined)
    // Give the bridge ample time to attempt hydration and re-evaluate.
    await new Promise(resolve => setTimeout(resolve, 1500))

    assert.equal(winner(slots, 'sidebar.workspaces'), OfficialSidebar,
      'a remote node without a baseline must NOT shadow the official sidebar')
    assert.equal(winner(slots, 'conversation.hero.workspace'), OfficialHero)
    assert.equal(slots.entries('sidebar.workspaces').length, 1,
      'no federation entry may be registered for an unhydrated remote node')
  } finally {
    for (const bundle of bundles) {
      await rm(bundle, { force: true })
      await rm(bundle.replace(/\.mjs$/, '.css'), { force: true })
    }
    await rm(root, { recursive: true, force: true })
  }
})
