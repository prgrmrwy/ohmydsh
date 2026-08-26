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

function run(command, args, cwd = REPO) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}`)
  return result.stdout
}

async function buildHarnessModule(root) {
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
export function StateDot({ state }) {
  return React.createElement('span', { 'data-state-dot': state })
}
export function Tooltip({ children }) { return children }
export function HoverCard({ anchor, content, copyText }) {
  return React.createElement('div', { 'data-hover-card': 'true', 'data-copy-text': copyText ?? '' },
    anchor,
    React.createElement('div', { 'data-hover-content': 'true' }, content),
  )
}
export function Menu({ open, anchor, items = [], onSelect, className }) {
  return React.createElement(React.Fragment, null,
    anchor,
    open ? createPortal(
      React.createElement('div', { className, role: 'menu' }, items.map(item =>
        item.separator ? React.createElement('hr', { key: item.id }) : React.createElement(
          'button',
          { key: item.id, type: 'button', disabled: item.disabled, onClick: () => onSelect(item.id) },
          item.label,
        ),
      )),
      document.body,
    ) : null,
  )
}
export function Modal({ open, onClose, title, closeLabel = 'Close', children, footer, className }) {
  if (!open) return null
  return createPortal(React.createElement('div', { className, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    React.createElement('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel),
    children,
    footer,
  ), document.body)
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
  const cache = path.join(root, 'cache')
  const source = path.join(root, 'source')
  const embed = path.join(root, 'embed')
  run(process.execPath, ['scripts/fetch-rc2-workspace-source.mjs', '--cache-dir', cache, '--output-dir', source])
  run(process.execPath, [
    'scripts/build-rc2-workspace-embed.mjs',
    '--source-dir', path.join(source, 'deepseek-harness-b150a551'),
    '--output-dir', embed,
  ])
  const bundleDir = path.join(REPO, 'node_modules/.cache/ohmydsh-federation-tests')
  await mkdir(bundleDir, { recursive: true })
  const testEntry = path.join(root, 'entry.ts')
  await writeFile(testEntry, `
export { Rc2WorkspaceNodeSection, WorkspaceBrowser } from ${JSON.stringify(path.join(embed, 'src/client/WorkspaceBrowser.tsx'))}
export { createWorkspaceViewStore } from ${JSON.stringify(path.join(embed, 'src/client/stores.ts'))}
`, 'utf8')
  const bundle = path.join(bundleDir, `node-section-${process.pid}-${Date.now()}.mjs`)
  run(path.join(REPO, 'node_modules/.bin/esbuild'), [
    testEntry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--jsx=automatic',
    `--outfile=${bundle}`,
    '--loader:.css=local-css',
    '--external:react',
    '--external:react/jsx-runtime',
    '--external:react-dom',
    `--alias:@deepseek-ai/dsh-client-ui-primitives=${primitives}`,
    `--alias:@deepseek-ai/dsh-client-runtime/client=${runtime}`,
    '--external:@deepseek-ai/dsh-client-ui-slots',
    '--external:clsx',
    '--log-level=error',
  ])
  return {
    module: await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`),
    bundle,
    css: bundle.replace(/\.mjs$/, '.css'),
  }
}

function hookOf(source) {
  return selector => useSyncExternalStore(
    source.subscribe,
    () => selector(source.getSnapshot()),
    () => selector(source.getSnapshot()),
  )
}

function fixedSource(snapshot) {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  }
}

function sid(node, native) {
  return `fed1:${node}:s:${Buffer.from(native).toString('base64url')}`
}

function wid(node, native) {
  return `fed1:${node}:w:${Buffer.from(native).toString('base64url')}`
}

function fixtures(node, globalCurrent, count = 7) {
  const workspaceId = wid(node, 'shared-workspace')
  const sessions = Array.from({ length: count }, (_, index) => {
    const id = sid(node, `shared-session-${index + 1}`)
    return {
      id,
      displayTitle: `${node}-session-${index + 1}`,
      cwd: `/synthetic/${node}/project`,
      running: index === 1,
      blank: false,
      updatedAt: 946684800000 - index * 60_000,
    }
  })
  sessions[0].pendingInteraction = 'question'
  sessions[2].completed = true
  const subagent = {
    id: sid(node, 'shared-subagent'),
    parentId: sessions[1].id,
    origin: 'subagent',
    displayTitle: `${node}-subagent`,
    cwd: `/synthetic/${node}/project`,
    running: true,
    blank: false,
    updatedAt: 946684800250,
  }
  const blank = {
    id: sid(node, 'shared-blank'),
    displayTitle: `${node}-blank`,
    cwd: `/synthetic/${node}/project`,
    running: false,
    blank: true,
    updatedAt: 946684800500,
  }
  const all = [...sessions, subagent, blank]
  const byId = Object.fromEntries(all.map(session => [session.id, session]))
  const ownsCurrent = all.some(session => session.id === globalCurrent)
  return {
    sessions: {
      ids: all.map(session => session.id),
      byId,
      current: ownsCurrent ? globalCurrent : undefined,
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
    workspaceId,
    sessionsList: sessions,
    blank,
  }
}

function click(element) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}

function textButtons(root, text) {
  return [...root.querySelectorAll('button')].filter(button => button.textContent?.trim() === text)
}

test('two real rc.2 NodeSections isolate store, selection, show-more, portals and action routing', { timeout: 120_000 }, async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'federation-node-section-'))
  let bundle
  let bundleCss
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
  const previous = {}
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'Event', 'getComputedStyle', 'localStorage']) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key],
    })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try {
    const { createRoot } = await import('react-dom/client')
    const built = await buildHarnessModule(rootDir)
    bundle = built.bundle
    bundleCss = built.css
    const { Rc2WorkspaceNodeSection, WorkspaceBrowser, createWorkspaceViewStore } = built.module
    const current = sid('node-a', 'shared-blank')
    const a = fixtures('node-a', current)
    const b = fixtures('node-b', current)
    const instanceA = createWorkspaceViewStore().create('fed1-node:node-a')
    const instanceB = createWorkspaceViewStore().create('fed1-node:node-b')
    instanceA.actions.setGroupExpanded(a.workspaceId, true)
    instanceB.actions.setGroupExpanded(b.workspaceId, true)
    assert.equal(instanceA.getSnapshot().groupExpansion[a.workspaceId], true)
    assert.equal(instanceA.getSnapshot().groupExpansion[b.workspaceId], undefined)
    assert.equal(instanceB.getSnapshot().groupExpansion[b.workspaceId], true)

    const spies = { a: [], b: [] }
    const t = (key, params) => params?.name === undefined ? key : `${key}:${params.name}`
    const props = (node, fixture, instance, calls) => ({
      nodeKey: node,
      overlayNamespace: node,
      groupBy: 'workspace',
      orderBy: 'manual',
      home: `/synthetic/${node}`,
      now: 946684900000,
      useSessions: hookOf(fixedSource(fixture.sessions)),
      useWorkspaces: hookOf(fixedSource(fixture.workspaces)),
      useStore: hookOf(instance),
      actions: instance.actions,
      startSession: workspaceId => calls.push(['startSession', workspaceId]),
      open: sessionId => calls.push(['open', sessionId]),
      renameSession: async (sessionId, title) => { calls.push(['renameSession', sessionId, title]) },
      forkSession: sessionId => calls.push(['forkSession', sessionId]),
      renameWorkspace: async (workspaceId, title) => { calls.push(['renameWorkspace', workspaceId, title]) },
      deleteWorkspace: async workspaceId => { calls.push(['deleteWorkspace', workspaceId]) },
      insertWorkspaceBefore: async (workspaceId, before) => { calls.push(['insertWorkspaceBefore', workspaceId, before]) },
      archiveSession: async sessionId => { calls.push(['archiveSession', sessionId]) },
      insertSessionBefore: async (workspaceId, sessionId, before) => { calls.push(['insertSessionBefore', workspaceId, sessionId, before]) },
      t,
    })

    const container = document.getElementById('root')
    const reactRoot = createRoot(container)
    await act(async () => {
      reactRoot.render(React.createElement(React.Fragment, null,
        React.createElement(Rc2WorkspaceNodeSection, { key: 'node-a', ...props('node-a', a, instanceA, spies.a) }),
        React.createElement(Rc2WorkspaceNodeSection, { key: 'node-b', ...props('node-b', b, instanceB, spies.b) }),
      ))
    })

    const sectionA = container.querySelector('[data-rc2-workspace-node-section="node-a"]')
    const sectionB = container.querySelector('[data-rc2-workspace-node-section="node-b"]')
    assert.ok(sectionA)
    assert.ok(sectionB)
    assert.equal(sectionA.querySelectorAll('[role="treeitem"][aria-selected="true"]').length, 1)
    assert.equal(sectionB.querySelectorAll('[role="treeitem"][aria-selected="true"]').length, 0)
    assert.match(sectionA.textContent, /session\.new/)
    assert.doesNotMatch(sectionB.textContent, /session\.new/)

    assert.equal(sectionA.querySelectorAll('[role="treeitem"][aria-selected]').length, 5)
    assert.equal(sectionB.querySelectorAll('[role="treeitem"][aria-selected]').length, 5)
    const showA = textButtons(sectionA, 'sessions.expand')[0]
    const showB = textButtons(sectionB, 'sessions.expand')[0]
    assert.ok(showA)
    assert.ok(showB)
    await act(async () => { click(showA) })
    assert.equal(sectionA.querySelectorAll('[role="treeitem"][aria-selected]').length, 8)
    assert.equal(sectionB.querySelectorAll('[role="treeitem"][aria-selected]').length, 5)

    const actionA = sectionA.querySelector(`button[aria-label^="actions.workspace.aria"]`)
    assert.ok(actionA)
    await act(async () => { click(actionA) })
    const portalMenuA = document.body.querySelector('.dsh-federation-node-overlay-node-a')
    assert.ok(portalMenuA)
    assert.equal(document.body.querySelector('.dsh-federation-node-overlay-node-b'), null)
    const rename = textButtons(portalMenuA, 'rename')[0]
    assert.ok(rename)
    await act(async () => { click(rename) })
    const dialogA = document.body.querySelector('.dsh-federation-node-overlay-node-a[role="dialog"]')
    assert.ok(dialogA)
    assert.equal(document.body.querySelector('.dsh-federation-node-overlay-node-b[role="dialog"]'), null)
    const input = dialogA.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      setter.call(input, 'node-a-renamed')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    const renameCommit = textButtons(dialogA, 'rename')[0]
    await act(async () => { click(renameCommit); await Promise.resolve() })
    assert.deepEqual(spies.a.at(-1), ['renameWorkspace', a.workspaceId, 'node-a-renamed'])
    assert.deepEqual(spies.b, [])

    const dragStart = new dom.window.Event('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(dragStart, 'dataTransfer', { value: { effectAllowed: '', setData() {} } })
    await act(async () => { sectionA.querySelector('[role="treeitem"][aria-expanded]').dispatchEvent(dragStart) })
    const crossDrop = new dom.window.Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(crossDrop, 'clientY', { value: 1 })
    await act(async () => { sectionB.querySelector('[role="treeitem"][aria-expanded]').dispatchEvent(crossDrop) })
    assert.equal(spies.b.some(call => call[0].startsWith('insert')), false)
    assert.equal(sectionB.querySelector('[class*="DropBefore"], [class*="DropAfter"]'), null)

    assert.equal(sectionA.querySelector('[aria-label="add workspace"]'), null)
    assert.equal(sectionB.querySelector('[aria-label="add workspace"]'), null)
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

test('single NodeSection is black-box equivalent to the official Browser subtree', { timeout: 120_000 }, async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'federation-node-differential-'))
  let bundle
  let bundleCss
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
  try {
    const { createRoot } = await import('react-dom/client')
    const built = await buildHarnessModule(rootDir)
    bundle = built.bundle
    bundleCss = built.css
    const { Rc2WorkspaceNodeSection, WorkspaceBrowser, createWorkspaceViewStore } = built.module
    const fixture = fixtures('node-diff', sid('node-diff', 'shared-blank'))
    const officialStore = createWorkspaceViewStore().create('diff-official')
    const extractedStore = createWorkspaceViewStore().create('diff-extracted')
    officialStore.actions.setGroupExpanded(fixture.workspaceId, true)
    extractedStore.actions.setGroupExpanded(fixture.workspaceId, true)
    officialStore.actions.setOrderBy('manual')
    extractedStore.actions.setOrderBy('manual')
    const calls = { official: [], extracted: [] }
    const t = (key, params) => params === undefined
      ? key
      : `${key}:${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}`
    const common = (instance, target) => ({
      useSessions: hookOf(fixedSource(fixture.sessions)),
      useWorkspaces: hookOf(fixedSource(fixture.workspaces)),
      useStore: hookOf(instance),
      actions: instance.actions,
      startSession: workspaceId => calls[target].push(['startSession', workspaceId]),
      open: sessionId => calls[target].push(['open', sessionId]),
      renameSession: async (sessionId, title) => { calls[target].push(['renameSession', sessionId, title]) },
      forkSession: sessionId => calls[target].push(['forkSession', sessionId]),
      renameWorkspace: async (workspaceId, title) => { calls[target].push(['renameWorkspace', workspaceId, title]) },
      deleteWorkspace: async workspaceId => { calls[target].push(['deleteWorkspace', workspaceId]) },
      insertWorkspaceBefore: async (workspaceId, before) => { calls[target].push(['insertWorkspaceBefore', workspaceId, before]) },
      archiveSession: async sessionId => { calls[target].push(['archiveSession', sessionId]) },
      insertSessionBefore: async (workspaceId, sessionId, before) => { calls[target].push(['insertSessionBefore', workspaceId, sessionId, before]) },
      t,
    })
    const officialProps = {
      ...common(officialStore, 'official'),
      wide: true,
      expandSidebar() {},
      createWorkspace: async () => fixture.workspaces.items[0],
      searchSessions: async () => ({ items: [], hasMore: false }),
      searchResultLimit: 20,
      useDirectoryFlow: () => false,
      useHostDescription: selector => selector({ home: '/synthetic/node-diff' }),
      renderSlot: () => null,
    }
    const extractedProps = {
      ...common(extractedStore, 'extracted'),
      nodeKey: 'node-diff',
      overlayNamespace: 'node-diff',
      groupBy: 'workspace',
      orderBy: 'manual',
      home: '/synthetic/node-diff',
      now: Date.now(),
    }
    const container = document.getElementById('root')
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(React.Fragment, null,
        React.createElement('div', { id: 'official' }, React.createElement(WorkspaceBrowser, officialProps)),
        React.createElement('div', { id: 'extracted' }, React.createElement(Rc2WorkspaceNodeSection, extractedProps)),
      ))
    })
    const official = container.querySelector('[data-rc2-workspace-node-section="official-local"]')
    const extracted = container.querySelector('[data-rc2-workspace-node-section="node-diff"]')
    assert.ok(official)
    assert.ok(extracted)

    const signature = section => [...section.querySelectorAll('[role="treeitem"], button[aria-expanded]')].map(element => ({
      role: element.getAttribute('role') ?? element.tagName,
      text: element.textContent.trim(),
      expanded: element.getAttribute('aria-expanded'),
      selected: element.getAttribute('aria-selected'),
      draggable: element.getAttribute('draggable'),
    }))
    assert.deepEqual(signature(extracted), signature(official))
    assert.deepEqual(
      [...extracted.querySelectorAll('[data-state-dot]')].map(dot => dot.getAttribute('data-state-dot')),
      [...official.querySelectorAll('[data-state-dot]')].map(dot => dot.getAttribute('data-state-dot')),
    )
    assert.ok(extracted.querySelector('[data-copy-text="node-diff-session-1"]'))
    assert.ok(official.querySelector('[data-copy-text="node-diff-session-1"]'))
    assert.match(extracted.textContent, /status\.subagentsRunning\.(one|many)/)
    assert.match(official.textContent, /status\.subagentsRunning\.(one|many)/)

    const overflowOfficial = textButtons(official, 'sessions.expand:n=3')[0]
    const overflowExtracted = textButtons(extracted, 'sessions.expand:n=3')[0]
    await act(async () => { click(overflowOfficial); click(overflowExtracted) })
    assert.deepEqual(signature(extracted), signature(official))

    const sessionAction = section => section.querySelector('button[aria-label^="actions.session.aria"]')
    await act(async () => { click(sessionAction(official)) })
    const officialMenu = document.body.querySelector('.dsh-federation-node-overlay-official-local[role="menu"]')
    assert.ok(officialMenu)
    await act(async () => { click(textButtons(officialMenu, 'menu.fork')[0]) })
    await act(async () => { click(sessionAction(extracted)) })
    const extractedMenu = document.body.querySelector('.dsh-federation-node-overlay-node-diff[role="menu"]')
    assert.ok(extractedMenu)
    await act(async () => { click(textButtons(extractedMenu, 'menu.fork')[0]) })
    assert.deepEqual(calls.extracted, calls.official)

    await act(async () => { click(sessionAction(official)) })
    await act(async () => { click(textButtons(document.body.querySelector('.dsh-federation-node-overlay-official-local[role="menu"]'), 'rename')[0]) })
    await act(async () => { click(sessionAction(extracted)) })
    await act(async () => { click(textButtons(document.body.querySelector('.dsh-federation-node-overlay-node-diff[role="menu"]'), 'rename')[0]) })
    const officialDialog = document.body.querySelector('.dsh-federation-node-overlay-official-local[role="dialog"]')
    const extractedDialog = document.body.querySelector('.dsh-federation-node-overlay-node-diff[role="dialog"]')
    assert.equal(officialDialog.getAttribute('aria-label'), extractedDialog.getAttribute('aria-label'))
    assert.equal(officialDialog.querySelector('input').getAttribute('aria-label'), extractedDialog.querySelector('input').getAttribute('aria-label'))
    const esc = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    await act(async () => { officialDialog.querySelector('input').dispatchEvent(esc); extractedDialog.querySelector('input').dispatchEvent(esc) })
    assert.ok(officialDialog.isConnected)
    assert.ok(extractedDialog.isConnected)
    await act(async () => { click(officialDialog.querySelector('button[aria-label="close"]')); click(extractedDialog.querySelector('button[aria-label="close"]')) })

    const css = await (await import('node:fs/promises')).readFile(bundleCss, 'utf8')
    assert.match(css, /prefers-reduced-motion:\s*reduce/)
    assert.equal(container.querySelector('#official [aria-label="search.sessions.aria"]') !== null, true)
    assert.equal(container.querySelector('#extracted [aria-label="search.sessions.aria"]'), null)
    assert.equal(container.querySelector('#official [data-rc2-workspace-node-section]') !== null, true)
    assert.equal(container.querySelector('#extracted [data-rc2-workspace-node-section]') !== null, true)
    await act(async () => { root.unmount() })
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
