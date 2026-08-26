import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import React, { act, useSyncExternalStore } from 'react'
import { JSDOM } from 'jsdom'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = path.join(REPO, 'packages/dsh-federation')

function run(command, args, cwd = REPO) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}`)
  return result.stdout
}

async function stubs(root) {
  const primitives = path.join(root, 'primitives.mjs')
  await writeFile(primitives, `
import React from 'react'
import { createPortal } from 'react-dom'
const icon = ({ className, ...props } = {}) => React.createElement('span', { className, ...props })
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
export function Button({ children, className, variant, ...props }) {
  return React.createElement('button', { className, ...props }, children)
}
export function StateDot({ state }) { return React.createElement('span', { 'data-state-dot': state }) }
export function Tooltip({ children }) { return children }
export function HoverCard({ anchor, content, copyText }) {
  return React.createElement('div', { 'data-copy-text': copyText ?? '' }, anchor, content)
}
export function Menu({ open, anchor, items = [], onSelect, className }) {
  return React.createElement(React.Fragment, null, anchor, open ? createPortal(
    React.createElement('div', { className, role: 'menu' }, items.map(item => item.separator
      ? React.createElement('hr', { key: item.id })
      : React.createElement('button', { key: item.id, type: 'button', onClick: () => onSelect(item.id) }, item.label))),
    document.body) : null)
}
export function Modal({ open, onClose, title, closeLabel = 'Close', children, footer, className }) {
  if (!open) return null
  return createPortal(React.createElement('div', { className, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    React.createElement('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel),
    children, footer), document.body)
}
`, 'utf8')
  const runtime = path.join(root, 'runtime.mjs')
  await writeFile(runtime, `
export function abbreviateHomePath(value, home) {
  return home && (value === home || value.startsWith(home + '/')) ? '~' + value.slice(home.length) : value
}
export function indexSubagentDescendants() { return new Map() }
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
        store: {
          getSnapshot: () => state,
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
          update(mutator) { mutator(state); for (const listener of listeners) listener() },
          set(next) { state = next; for (const listener of listeners) listener() },
        },
      }
    },
  }
}
`, 'utf8')
  return { primitives, runtime }
}

async function buildShellBundle(root) {
  const { primitives, runtime } = await stubs(root)
  // The package's own prepare step materializes the pinned official embed.
  run('npm', ['run', 'prepare:embed', '--silent'], PACKAGE)
  const entry = path.join(root, 'entry.ts')
  await writeFile(entry, `
export { FederatedNodeShell } from ${JSON.stringify(path.join(PACKAGE, 'src/client/shell/NodeShell.tsx'))}
export { createWorkspaceViewStore } from ${JSON.stringify(path.join(PACKAGE, '.generated/workspace-embed/src/client/stores.ts'))}
`, 'utf8')
  const outDir = path.join(REPO, 'node_modules/.cache/ohmydsh-federation-tests')
  await mkdir(outDir, { recursive: true })
  const bundle = path.join(outDir, `node-shell-${process.pid}-${Date.now()}.mjs`)
  run(path.join(REPO, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node', '--jsx=automatic',
    `--outfile=${bundle}`, '--loader:.css=local-css',
    '--external:react', '--external:react/jsx-runtime', '--external:react-dom',
    `--alias:@deepseek-ai/dsh-client-ui-primitives=${primitives}`,
    `--alias:@deepseek-ai/dsh-client-runtime/client=${runtime}`,
    '--external:@deepseek-ai/dsh-client-ui-slots', '--external:clsx', '--log-level=error',
  ])
  return { module: await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`), bundle, css: bundle.replace(/\.mjs$/, '.css') }
}

function hookOf(snapshot) {
  const source = { getSnapshot: () => snapshot, subscribe: () => () => {} }
  return selector => useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()), () => selector(source.getSnapshot()))
}

function storeHook(instance) {
  return selector => useSyncExternalStore(instance.subscribe, () => selector(instance.getSnapshot()), () => selector(instance.getSnapshot()))
}

const sid = (node, native) => `fed1:${node}:s:${Buffer.from(native).toString('base64url')}`
const wid = (node, native) => `fed1:${node}:w:${Buffer.from(native).toString('base64url')}`

function fixture(node) {
  const workspaceId = wid(node, 'shared-workspace')
  const sessions = Array.from({ length: 3 }, (_, index) => ({
    id: sid(node, `shared-session-${index + 1}`),
    displayTitle: `${node}-session-${index + 1}`,
    cwd: `/synthetic/${node}/project`,
    running: index === 0,
    blank: false,
    updatedAt: 946684800000 - index * 1000,
  }))
  return {
    workspaceId,
    sessions: {
      ids: sessions.map(session => session.id),
      byId: Object.fromEntries(sessions.map(session => [session.id, session])),
      current: undefined,
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    },
    workspaces: {
      items: [{
        workspaceId,
        path: `/synthetic/${node}/project`,
        title: `${node}-workspace`,
        sessionIds: sessions.map(session => session.id),
        createdAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:01.000Z',
      }],
      archivedSessionIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
      baselinesReady: true,
      recentWorkspaceId: workspaceId,
    },
  }
}

test('federated node shell mounts one official section per node with isolated stores and portals', { timeout: 180_000 }, async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'federation-node-shell-'))
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
  const previous = {}
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'Event', 'KeyboardEvent', 'getComputedStyle', 'localStorage']) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key],
    })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let bundle
  let bundleCss
  try {
    const { createRoot } = await import('react-dom/client')
    const built = await buildShellBundle(rootDir)
    bundle = built.bundle
    bundleCss = built.css
    const { FederatedNodeShell, createWorkspaceViewStore } = built.module

    const nodes = ['this-mac', 'vm-a', 'vm-b']
    const fixtures = Object.fromEntries(nodes.map(node => [node, fixture(node)]))
    const stores = Object.fromEntries(nodes.map(node => [node, createWorkspaceViewStore().create(`fed1-node:${node}`)]))
    const calls = Object.fromEntries(nodes.map(node => [node, []]))
    for (const node of nodes) stores[node].actions.setGroupExpanded(fixtures[node].workspaceId, true)

    const t = (key, params) => (params?.name === undefined ? key : `${key}:${params.name}`)
    const rows = [
      { nodeId: 'this-mac', displayName: 'This Mac', kind: 'local', order: 0, status: 'online', writable: true, showsSkeleton: false, runningSessionCount: 1, pendingInteractionCount: 0, expandable: true },
      { nodeId: 'vm-a', displayName: 'VM A', kind: 'remote', order: 1, status: 'online', writable: true, showsSkeleton: false, runningSessionCount: 1, pendingInteractionCount: 0, expandable: true },
      { nodeId: 'vm-b', displayName: 'VM B', kind: 'remote', order: 2, status: 'stale', writable: false, showsSkeleton: true, runningSessionCount: 0, pendingInteractionCount: 0, expandable: true },
    ]
    const bindings = rows.map(row => ({
      row,
      home: `/synthetic/${row.nodeId}`,
      useSessions: hookOf(fixtures[row.nodeId].sessions),
      useWorkspaces: hookOf(fixtures[row.nodeId].workspaces),
      useStore: storeHook(stores[row.nodeId]),
      actions: stores[row.nodeId].actions,
      startSession: workspaceId => calls[row.nodeId].push(['startSession', workspaceId]),
      open: sessionId => calls[row.nodeId].push(['open', sessionId]),
      renameSession: async (sessionId, title) => { calls[row.nodeId].push(['renameSession', sessionId, title]) },
      forkSession: sessionId => calls[row.nodeId].push(['forkSession', sessionId]),
      renameWorkspace: async (workspaceId, title) => { calls[row.nodeId].push(['renameWorkspace', workspaceId, title]) },
      deleteWorkspace: async workspaceId => { calls[row.nodeId].push(['deleteWorkspace', workspaceId]) },
      insertWorkspaceBefore: async (workspaceId, before) => { calls[row.nodeId].push(['insertWorkspaceBefore', workspaceId, before]) },
      archiveSession: async sessionId => { calls[row.nodeId].push(['archiveSession', sessionId]) },
      insertSessionBefore: async (workspaceId, sessionId, before) => { calls[row.nodeId].push(['insertSessionBefore', workspaceId, sessionId, before]) },
      t,
    }))

    const container = document.getElementById('root')
    const reactRoot = createRoot(container)
    await act(async () => {
      reactRoot.render(React.createElement(FederatedNodeShell, {
        bindings,
        groupBy: 'workspace',
        orderBy: 'manual',
        now: 946684900000,
        renderNodeHeader: row => React.createElement('div', { 'data-node-row': row.nodeId, 'data-node-status': row.status }, row.displayName),
        renderSkeleton: row => React.createElement('div', { 'data-node-skeleton': row.nodeId }, 'offline'),
      }))
    })

    // Node chrome is federation-owned and present for every node.
    assert.deepEqual([...container.querySelectorAll('[data-node-row]')].map(el => el.getAttribute('data-node-row')), nodes)
    assert.equal(container.querySelector('[data-node-row="vm-b"]').getAttribute('data-node-status'), 'stale')

    // One official subtree per live node, keyed by opaque node identity.
    const sections = [...container.querySelectorAll('[data-rc2-workspace-node-section]')]
      .map(el => el.getAttribute('data-rc2-workspace-node-section'))
    assert.deepEqual(sections, ['fed1-node:this-mac', 'fed1-node:vm-a'])

    // A stale node renders the read-only skeleton instead of an official subtree.
    assert.ok(container.querySelector('[data-node-skeleton="vm-b"]'))

    // The shell renders no second global search input of its own.
    assert.equal(container.querySelectorAll('[aria-label="search.sessions.aria"]').length, 0)

    // Per-node view stores stay isolated.
    assert.equal(stores['this-mac'].getSnapshot().groupExpansion[fixtures['this-mac'].workspaceId], true)
    assert.equal(stores['this-mac'].getSnapshot().groupExpansion[fixtures['vm-a'].workspaceId], undefined)

    // Actions route to the owning node only.
    const firstSection = container.querySelector('[data-rc2-workspace-node-section="fed1-node:this-mac"]')
    // Group rows carry aria-expanded; session rows do not.
    const treeItem = [...firstSection.querySelectorAll('[role="treeitem"]')]
      .find(element => element.getAttribute('aria-expanded') === null)
    assert.ok(treeItem, 'expected at least one session row in the official subtree')
    await act(async () => {
      treeItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    assert.equal(calls['vm-a'].length, 0)
    assert.equal(calls['vm-b'].length, 0)
    assert.ok(calls['this-mac'].length >= 1)
    assert.ok(calls['this-mac'].every(([, id]) => String(id).startsWith('fed1:this-mac:')))

    // Node-owned dialog/portal namespaces do not collide.
    const action = firstSection.querySelector('button[aria-label^="actions.session.aria"]')
    if (action !== null) {
      await act(async () => { action.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
      assert.ok(document.body.querySelector('.dsh-federation-node-overlay-n-this-mac[role="menu"]'))
      assert.equal(document.body.querySelector('.dsh-federation-node-overlay-n-vm-a[role="menu"]'), null)
    }

    await act(async () => { reactRoot.unmount() })
  } finally {
    if (bundle) await rm(bundle, { force: true })
    if (bundleCss) await rm(bundleCss, { force: true })
    await rm(rootDir, { recursive: true, force: true })
    dom.window.close()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, descriptor)
    }
  }
})
