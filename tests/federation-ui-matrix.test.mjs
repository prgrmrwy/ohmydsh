import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import React, { act, useSyncExternalStore } from 'react'
import { JSDOM } from 'jsdom'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = path.join(REPO, 'packages/dsh-federation')

/**
 * Declared rc.2 WorkspaceBrowser behaviour matrix. Each row is one behaviour the
 * federated Node section must keep, checked against the real official-derived
 * component rather than a reimplementation.
 */
const MATRIX = [
  'collapsed-session-limit',
  'show-more-expands-remainder',
  'blank-session-hidden-until-current',
  'workspace-row-menu-opens',
  'session-row-menu-opens',
  'rename-dialog-labels',
  'running-status-dot',
  'subagent-running-summary',
  'hover-copy-target',
  'session-rows-are-treeitems',
  'group-row-exposes-aria-expanded',
  'selected-session-marked',
  'keyboard-focusable-rows',
  'reduced-motion-stylesheet',
  'no-embedded-global-search',
]

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
export function indexSubagentDescendants(byId) {
  const counts = new Map()
  for (const summary of Object.values(byId)) {
    if (summary.origin !== 'subagent' || !summary.running || !summary.parentId) continue
    const current = counts.get(summary.parentId) ?? { runningCount: 0 }
    counts.set(summary.parentId, { runningCount: current.runningCount + 1 })
  }
  return counts
}
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

async function buildBundle(root) {
  const { primitives, runtime } = await stubs(root)
  run('npm', ['run', 'prepare:embed', '--silent'], PACKAGE)
  const entry = path.join(root, 'entry.ts')
  await writeFile(entry, `
export { Rc2WorkspaceNodeSection, createWorkspaceViewStore } from ${JSON.stringify(path.join(PACKAGE, '.generated/workspace-embed/src/client/federation.ts'))}
`, 'utf8')
  const outDir = path.join(REPO, 'node_modules/.cache/ohmydsh-federation-tests')
  await mkdir(outDir, { recursive: true })
  const bundle = path.join(outDir, `ui-matrix-${process.pid}-${Date.now()}.mjs`)
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

const sid = native => `fed1:vm-a:s:${Buffer.from(native).toString('base64url')}`
const wid = native => `fed1:vm-a:w:${Buffer.from(native).toString('base64url')}`

function fixture(current) {
  const workspaceId = wid('workspace')
  const sessions = Array.from({ length: 8 }, (_, index) => ({
    id: sid(`session-${index + 1}`),
    displayTitle: `session-${index + 1}`,
    cwd: '/synthetic/vm-a/project',
    running: index === 0,
    blank: false,
    updatedAt: 946684800000 - index * 1000,
  }))
  const subagent = {
    id: sid('subagent'),
    parentId: sessions[0].id,
    origin: 'subagent',
    displayTitle: 'subagent',
    cwd: '/synthetic/vm-a/project',
    running: true,
    blank: false,
    updatedAt: 946684800500,
  }
  const blank = {
    id: sid('blank'),
    displayTitle: 'blank',
    cwd: '/synthetic/vm-a/project',
    running: false,
    blank: true,
    updatedAt: 946684800900,
  }
  const all = [...sessions, subagent, blank]
  return {
    workspaceId,
    blankId: blank.id,
    sessions: {
      ids: all.map(session => session.id),
      byId: Object.fromEntries(all.map(session => [session.id, session])),
      current,
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    },
    workspaces: {
      items: [{
        workspaceId,
        path: '/synthetic/vm-a/project',
        title: 'vm-a-workspace',
        sessionIds: all.map(session => session.id),
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

function hookOf(snapshot) {
  const source = { getSnapshot: () => snapshot, subscribe: () => () => {} }
  return selector => useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()), () => selector(source.getSnapshot()))
}

function storeHook(instance) {
  return selector => useSyncExternalStore(instance.subscribe, () => selector(instance.getSnapshot()), () => selector(instance.getSnapshot()))
}

test('official rc.2 WorkspaceBrowser behaviour matrix holds for the federated Node section', { timeout: 180_000 }, async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'federation-ui-matrix-'))
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
  const previous = {}
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'Event', 'KeyboardEvent', 'getComputedStyle', 'localStorage']) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true,
      value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key],
    })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const covered = new Set()
  const check = (name, condition, detail = '') => {
    assert.ok(MATRIX.includes(name), `undeclared matrix row ${name}`)
    assert.ok(condition, `matrix row ${name} failed ${detail}`)
    covered.add(name)
  }
  let bundle
  let bundleCss
  try {
    const { createRoot } = await import('react-dom/client')
    const built = await buildBundle(rootDir)
    bundle = built.bundle
    bundleCss = built.css
    const { Rc2WorkspaceNodeSection, createWorkspaceViewStore } = built.module

    const data = fixture(sid('session-1'))
    const store = createWorkspaceViewStore().create('fed1-node:vm-a')
    store.actions.setGroupExpanded(data.workspaceId, true)
    const calls = []
    const t = (key, params) => (params?.n === undefined ? key : `${key}:n=${params.n}`)
    const props = {
      nodeKey: 'fed1-node:vm-a',
      overlayNamespace: 'n-vm-a',
      groupBy: 'workspace',
      orderBy: 'manual',
      home: '/synthetic/vm-a',
      now: 946684900000,
      useSessions: hookOf(data.sessions),
      useWorkspaces: hookOf(data.workspaces),
      useStore: storeHook(store),
      actions: store.actions,
      startSession: workspaceId => calls.push(['startSession', workspaceId]),
      open: sessionId => calls.push(['open', sessionId]),
      renameSession: async (...args) => { calls.push(['renameSession', ...args]) },
      forkSession: sessionId => calls.push(['forkSession', sessionId]),
      renameWorkspace: async (...args) => { calls.push(['renameWorkspace', ...args]) },
      deleteWorkspace: async workspaceId => { calls.push(['deleteWorkspace', workspaceId]) },
      insertWorkspaceBefore: async (...args) => { calls.push(['insertWorkspaceBefore', ...args]) },
      archiveSession: async sessionId => { calls.push(['archiveSession', sessionId]) },
      insertSessionBefore: async (...args) => { calls.push(['insertSessionBefore', ...args]) },
      t,
    }

    const container = document.getElementById('root')
    const reactRoot = createRoot(container)
    await act(async () => { reactRoot.render(React.createElement(Rc2WorkspaceNodeSection, props)) })
    const section = () => container.querySelector('[data-rc2-workspace-node-section="fed1-node:vm-a"]')
    const sessionRows = () => [...section().querySelectorAll('[role="treeitem"]')].filter(el => el.getAttribute('aria-expanded') === null)
    const click = element => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    const buttonsWithText = (root, text) => [...root.querySelectorAll('button')].filter(b => b.textContent.trim() === text)

    const collapsedCount = sessionRows().length
    check('collapsed-session-limit', collapsedCount === 5, `got ${collapsedCount}`)
    check('session-rows-are-treeitems', sessionRows().every(row => row.getAttribute('role') === 'treeitem'))
    check('group-row-exposes-aria-expanded', section().querySelector('[role="treeitem"][aria-expanded="true"]') !== null)
    check('selected-session-marked', section().querySelectorAll('[role="treeitem"][aria-selected="true"]').length === 1)
    check('keyboard-focusable-rows', sessionRows().every(row => row.getAttribute('tabindex') !== null || row.tagName === 'BUTTON' || row.querySelector('button') !== null))
    check('running-status-dot', section().querySelector('[data-state-dot]') !== null)
    check('subagent-running-summary', /status\.subagentsRunning/.test(section().textContent))
    check('hover-copy-target', section().querySelector('[data-copy-text]') !== null)
    check('no-embedded-global-search', section().querySelector('[aria-label="search.sessions.aria"]') === null)

    // Blank sessions stay hidden until they are the current session.
    check('blank-session-hidden-until-current', !sessionRows().some(row => row.textContent.includes('blank')))

    const showMore = buttonsWithText(section(), 'sessions.expand:n=4')[0] ?? buttonsWithText(section(), 'sessions.expand:n=3')[0]
    assert.ok(showMore, 'expected a show-more control for the overflowing group')
    await act(async () => { click(showMore) })
    check('show-more-expands-remainder', sessionRows().length > collapsedCount, `got ${sessionRows().length}`)

    const workspaceAction = section().querySelector('button[aria-label^="actions.workspace.aria"]')
    assert.ok(workspaceAction)
    await act(async () => { click(workspaceAction) })
    const workspaceMenu = document.body.querySelector('.dsh-federation-node-overlay-n-vm-a[role="menu"]')
    check('workspace-row-menu-opens', workspaceMenu !== null)
    await act(async () => { click(workspaceAction) })

    const sessionAction = section().querySelector('button[aria-label^="actions.session.aria"]')
    assert.ok(sessionAction)
    await act(async () => { click(sessionAction) })
    const sessionMenu = document.body.querySelector('.dsh-federation-node-overlay-n-vm-a[role="menu"]')
    check('session-row-menu-opens', sessionMenu !== null)
    const rename = buttonsWithText(sessionMenu, 'rename')[0] ?? buttonsWithText(sessionMenu, 'menu.rename')[0]
    if (rename !== undefined) {
      await act(async () => { click(rename) })
      const dialog = document.body.querySelector('.dsh-federation-node-overlay-n-vm-a[role="dialog"]')
      check('rename-dialog-labels', dialog !== null && dialog.getAttribute('aria-label') !== null && dialog.querySelector('input') !== null)
      await act(async () => { click(dialog.querySelector('button[aria-label]')) })
    } else {
      check('rename-dialog-labels', false, 'rename entry missing from the session menu')
    }

    const css = await readFile(bundleCss, 'utf8')
    check('reduced-motion-stylesheet', /prefers-reduced-motion:\s*reduce/.test(css))

    const missing = MATRIX.filter(row => !covered.has(row))
    assert.deepEqual(missing, [], `matrix rows not exercised: ${missing.join(', ')}`)
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
