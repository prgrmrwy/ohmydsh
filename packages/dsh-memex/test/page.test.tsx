// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemexResolveResult, MemexStoreView, MemexStoresResult, MemexWorkspacesResult } from '../src/contract.js'
import { MEMEX_REMOTE_ENDPOINT, MEMEX_RESOLVE_ENDPOINT, MEMEX_STORES_ENDPOINT, MEMEX_WORKSPACES_ENDPOINT } from '../src/contract.js'
import { MemexSettingsSection } from '../src/client/page.js'
import type { MemexSettingsShape } from '../src/client/settings-model.js'

// React 18 needs this flag for act() outside a testing library.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NS = '/home/u/.dsh-memex'
const HOME = '/home/u'

/**
 * Type into a React-controlled input.
 *
 * Assigning `.value` directly bypasses React's value tracker, so the onChange
 * never fires; the native setter is what React's synthetic event reads.
 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function store(overrides: Partial<MemexStoreView> & { scope: string }): MemexStoreView {
  return {
    home: `${NS}/${overrides.scope}`,
    homeSource: 'namespace',
    publish: 'external',
    publishKnown: true,
    source: 'config',
    declared: true,
    primary: false,
    exists: true,
    pathPrefixes: [],
    remotePatterns: [],
    sync: { known: true, configured: false },
    ...overrides,
  }
}

const query = `${NS}/probed`

function routeOf(scope: string, path: string, overrides: Partial<MemexResolveResult> = {}): MemexResolveResult {
  return {
    path,
    scope,
    home: `${NS}/${scope}`,
    publish: 'external',
    publishKnown: true,
    source: 'local',
    exists: true,
    local: true,
    ...overrides,
  }
}

function registry(items: ReadonlyArray<{ title: string; path: string; route?: MemexResolveResult }>): MemexWorkspacesResult {
  return {
    known: true,
    homeDir: HOME,
    items: items.map((item, index) => ({
      id: `ws-${String(index)}`,
      title: item.title,
      path: item.path,
      ...(item.route === undefined ? {} : { route: item.route }),
    })),
  }
}

interface Harness {
  readonly container: HTMLElement
  readonly rpcCalls: Array<{ endpoint: string; params: unknown }>
  readonly mutations: unknown[]
  readonly roots: Root[]
  text(): string
  button(label: string): HTMLButtonElement
  /** Buttons by their aria-label, for the ones whose text is a glyph. */
  aria(label: string): HTMLButtonElement[]
  inputs(): HTMLInputElement[]
  checkbox(label: string): HTMLInputElement
  inputByPlaceholder(placeholder: string): HTMLInputElement
  expand(index: number): Promise<void>
  choose(label: string): Promise<void>
  rerender(stores: MemexStoresResult | undefined): Promise<void>
  unmount(): Promise<void>
}

const live: Harness[] = []

async function render(
  settings: MemexSettingsShape,
  options: { stores?: MemexStoreView[]; storesFail?: boolean; workspaces?: MemexWorkspacesResult; workspacesFail?: boolean } = {},
): Promise<Harness> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const rpcCalls: Array<{ endpoint: string; params: unknown }> = []
  const mutations: unknown[] = []
  let mode: 'ok' | 'fail' = options.storesFail === true ? 'fail' : 'ok'
  let stores: MemexStoreView[] = options.stores ?? []
  // Configuration-only by default: a test that cares about the registry passes
  // one, so the two shapes (registry-backed and degraded) stay distinguishable.
  const workspaces: MemexWorkspacesResult = options.workspaces ?? { known: false, homeDir: HOME, items: [] }

  const snapshot = { status: 'ready' as const, value: settings, base: undefined, user: undefined, revision: 7, writable: true, mode: 'host' as const }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    mutate: async (ops: unknown) => { mutations.push(ops) },
    set: async () => undefined,
    unset: async () => undefined,
  }
  const rpc = {
    // The browser RPC face is call(channel, endpoint, params).
    call: async (_channel: string, endpoint: string, params?: unknown) => {
      rpcCalls.push({ endpoint, params })
      if (endpoint === MEMEX_STORES_ENDPOINT) {
        if (mode === 'fail') return { ok: false, error: { message: 'channel down' } }
        return { ok: true, value: { kernel: { expected: '0.4.1', version: '0.4.1', matches: true }, namespaceDir: NS, stores } }
      }
      if (endpoint === MEMEX_WORKSPACES_ENDPOINT) {
        if (mode === 'fail' || options.workspacesFail === true) return { ok: false, error: { message: 'unknown endpoint "workspaces"' } }
        return { ok: true, value: workspaces }
      }
      if (endpoint === MEMEX_RESOLVE_ENDPOINT) {
        return { ok: true, value: { path: '/probe', scope: 'probed', home: query, publish: 'external', publishKnown: true, source: 'local', exists: false, local: true } }
      }
      if (endpoint === MEMEX_REMOTE_ENDPOINT) return { ok: true, value: { status: 'ok', output: 'done' } }
      return { ok: false, error: { message: `unexpected ${endpoint}` } }
    },
  }

  const harness: Harness = {
    container,
    rpcCalls,
    mutations,
    roots: [root],
    text: () => container.textContent ?? '',
    button: label => {
      const found = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === label)
      if (found === undefined) throw new Error(`no button labelled ${label} in: ${harness.text()}`)
      return found
    },
    aria: label => [...container.querySelectorAll('button')]
      .filter(candidate => candidate.getAttribute('aria-label') === label),
    inputs: () => [...container.querySelectorAll('input')],
    checkbox: label => {
      const found = [...container.querySelectorAll('input')].find(input => input.type === 'checkbox' && input.getAttribute('aria-label') === label)
      if (found === undefined) throw new Error(`no checkbox labelled ${label} in: ${harness.text()}`)
      return found
    },
    inputByPlaceholder: placeholder => {
      const found = [...container.querySelectorAll('input')].find(candidate => candidate.placeholder === placeholder)
      if (found === undefined) throw new Error(`no input with placeholder ${placeholder} in: ${harness.text()}`)
      return found
    },
    // Entries are collapsed by default; opening one is how its facts appear.
    expand: async (index) => {
      const opens = harness.aria('actionExpand')
      const target = opens[index]
      if (target === undefined) throw new Error(`no collapsed entry at index ${String(index)} in: ${harness.text()}`)
      await act(async () => { target.click() })
    },
    choose: async (label) => {
      const select = container.querySelector('select')
      if (select === null) throw new Error(`no picker open in: ${harness.text()}`)
      const option = [...select.options].find(item => item.textContent?.startsWith(label))
      if (option === undefined) throw new Error(`no candidate ${label} in: ${[...select.options].map(item => item.textContent).join(', ')}`)
      await act(async () => {
        select.value = option.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
    },
    rerender: async (next) => {
      stores = next?.stores ?? []
      mode = next === undefined ? 'fail' : 'ok'
      await act(async () => { root.render(<Page />) })
    },
    unmount: async () => { await act(async () => { root.unmount() }) },
  }

  const Page = (): JSX.Element => (
    <MemexSettingsSection
      rpc={rpc as never}
      t={((key: string) => key) as never}
      scope={scope as never}
    />
  )

  await act(async () => { root.render(<Page />) })
  await act(async () => { await Promise.resolve() })
  live.push(harness)
  return harness
}

afterEach(async () => {
  while (live.length > 0) {
    const harness = live.pop()!
    await harness.unmount()
    harness.container.remove()
  }
})

describe('memory settings page', () => {
  /**
   * Card browsing must only be offered where it can actually work. Each case
   * below is a state in which clicking would be guaranteed to fail, so the
   * button's absence IS the behaviour under test.
   */
  it('offers card browsing for a materialized, memory-on library once expanded', async () => {
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'] }] }, {
      stores: [store({ scope: 'nexus', exists: true })],
    })
    // List state shows role, name and counts only — actions belong to the
    // expanded view, so the browse action must not appear before opening.
    expect(h.text()).not.toContain('actionBrowse')
    await h.expand(0)
    expect(h.text()).toContain('actionBrowse')
  })

  it('does not offer browsing for a library with no cards directory', async () => {
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'] }] }, {
      stores: [store({ scope: 'nexus', exists: false })],
    })
    await h.expand(0)
    expect(h.text()).not.toContain('actionBrowse')
  })

  it('does not offer browsing for a memory-off workspace', async () => {
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], memory: false }] }, {
      stores: [store({ scope: 'nexus', exists: true, memory: false })],
    })
    // Memory-off workspaces live in the collapsed group; expanding it must not
    // reveal a browse action either.
    expect(h.text()).not.toContain('actionBrowse')
  })

  it('shows the default library path as a placeholder, never as a configured value', async () => {
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'] }] })
    await h.expand(0)
    const homeInput = h.inputByPlaceholder(`${NS}/nexus`)
    expect(homeInput.value).toBe('')
    // The default appears once, as the placeholder — never twice as a value.
    expect(h.text()).not.toContain(`${NS}/nexus`)
  })

  it('lists the host workspaces and gives an undeclared one its derived entry', async () => {
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], primary: true }] }, {
      workspaces: registry([
        { title: 'nexus', path: '/work/nexus', route: routeOf('nexus', '/work/nexus', { source: 'config' }) },
        { title: 'learning', path: '/home/u/Documents/learning', route: routeOf('documents-learning', '/home/u/Documents/learning') },
      ]),
      stores: [store({ scope: 'nexus' }), store({ scope: 'documents-learning', declared: false, source: 'derived' })],
    })
    const blocks = h.container.querySelectorAll('section.dshmx-lib')
    expect(blocks).toHaveLength(2)
    // The workspace is the block's subject: title first, directory as its fact.
    expect(blocks[0]!.querySelector('.dshmx-ws-title')?.textContent).toBe('nexus')
    expect(blocks[0]!.querySelector('.dshmx-ws-path')?.textContent).toBe('/work/nexus')
    // A workspace nothing declares still appears, marked as derived — and nothing
    // about it is written to the configuration.
    expect(blocks[1]!.textContent).toContain('documents-learning')
    expect(blocks[1]!.textContent).toContain('assumedLabel')
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toEqual([[
      { op: 'set', path: ['scopes'], value: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], primary: true }] },
    ]])
  })

  it('labels the derived primary when a fallback row sits under it', async () => {
    // Measured on the live page: a lone primary above an "additional" fallback
    // left the primary unlabelled, so the block read as if nothing were primary.
    const h = await render({ scopes: [] }, {
      workspaces: registry([{ title: 'dev-infra-server', path: '/home/u/dev/dev-infra-server', route: routeOf('aiby-dev-infra-server', '/home/u/dev/dev-infra-server', { source: 'derived' }) }]),
      stores: [store({ scope: 'aiby-dev-infra-server', declared: false, source: 'derived' }), store({ scope: 'personal', cards: 10 })],
    })
    const roles = [...h.container.querySelectorAll('.dshmx-role')].map(node => node.textContent)
    expect(roles).toEqual(['primaryBadge', 'additionalBadge'])
    const lines = [...h.container.querySelectorAll('.dshmx-entry-line')]
    expect(lines[0]!.querySelector('.dshmx-role')?.textContent).toBe('primaryBadge')
    expect(lines[0]!.textContent).toContain('aiby-dev-infra-server')
    expect(lines[0]!.textContent).toContain('assumedLabel')
  })

  it('leaves a lone entry unlabelled, because there is nothing to contrast', async () => {
    const h = await render({ scopes: [{ name: 'personal', pathPrefixes: ['/home/u/work/proj'] }] }, {
      workspaces: registry([{ title: 'proj', path: '/home/u/work/proj' }]),
      stores: [store({ scope: 'personal' })],
    })
    expect(h.container.querySelectorAll('.dshmx-role')).toHaveLength(0)
  })

  it('shows only role, name and card count until an entry is opened', async () => {
    const h = await render(
      { scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'] }] },
      {
        workspaces: registry([{ title: 'nexus', path: '/work/nexus' }]),
        stores: [store({ scope: 'nexus', cards: 3, sync: { known: true, configured: true, remote: 'git@host:org/repo.git', auto: true } })],
      },
    )
    const collapsed = h.container.querySelector('.dshmx-entry-line')!
    expect(collapsed.textContent).toContain('nexus')
    expect(collapsed.textContent).toContain(`3 cards`)
    // Nothing from the detail belongs on the collapsed line.
    expect(collapsed.textContent).not.toContain('git@host:org/repo.git')
    expect(h.container.querySelector('.dshmx-facts')).toBeNull()

    await h.expand(0)
    expect(h.container.querySelector('.dshmx-facts')?.textContent).toContain('git@host:org/repo.git')
    // Opening is a view state, not a configuration change.
    expect(h.text()).toContain('saved')
    expect(h.mutations).toHaveLength(0)
  })

  it('renders a configured remote with its state and no creation-flavoured action', async () => {
    const h = await render(
      { scopes: [{ name: 'nexus' }] },
      { stores: [store({ scope: 'nexus', sync: { known: true, configured: true, remote: 'git@code.byted.org:apaas/memex-nexus.git', auto: true, lastSync: '2026-09-19T18:07:37.638Z' } })] },
    )
    await h.expand(0)
    expect(h.text()).toContain('git@code.byted.org:apaas/memex-nexus.git')
    // Facts read as labelled pairs, not one middot-joined string.
    expect(h.text()).toContain('factAuto')
    expect(h.text()).toContain('on')
    expect(h.text()).toContain('2026-09-19T18:07:37.638Z')
    const labels = [...h.container.querySelectorAll('button')].map(button => button.textContent?.trim())
    expect(labels).toContain('actionSync')
    expect(labels).toContain('actionPull')
    expect(labels).toContain('actionChangeRemote')
    expect(labels).not.toContain('actionConfigureRemote')
    expect(h.text().toLowerCase()).not.toContain('init')
  })

  it('offers configuration, not initialisation, for a library without a remote', async () => {
    const h = await render({ scopes: [{ name: 'nexus' }] }, { stores: [store({ scope: 'nexus' })] })
    await h.expand(0)
    expect(h.text()).toContain('remoteUnconfigured')
    const labels = [...h.container.querySelectorAll('button')].map(button => button.textContent?.trim())
    expect(labels).toContain('actionConfigureRemote')
    expect(labels).not.toContain('actionSync')
  })

  it('requires a confirmation click before changing a remote', async () => {
    const h = await render(
      { scopes: [{ name: 'nexus' }] },
      { stores: [store({ scope: 'nexus', sync: { known: true, configured: true, remote: 'old@host:org/repo.git', auto: false } })] },
    )
    await h.expand(0)
    await act(async () => { h.button('actionChangeRemote').click() })
    expect(h.text()).toContain('changeRemoteWarning')
    expect(h.rpcCalls.filter(call => call.endpoint === MEMEX_REMOTE_ENDPOINT)).toHaveLength(0)

    const urlInput = h.inputByPlaceholder('urlPlaceholder')
    await act(async () => { typeInto(urlInput, 'git@host:org/new.git') })
    await act(async () => { h.button('actionConfirmChange').click() })
    expect(h.rpcCalls.filter(call => call.endpoint === MEMEX_REMOTE_ENDPOINT)).toEqual([
      { endpoint: MEMEX_REMOTE_ENDPOINT, params: { scope: 'nexus', action: 'init', url: 'git@host:org/new.git' } },
    ])
  })

  it('blocks saving conflicting drafts and explains why', async () => {
    const h = await render({ scopes: [{ name: 'one', home: '/libs/shared' }, { name: 'two', home: '/libs/shared' }] })
    expect(h.text()).toContain('conflictHome')
    expect(h.button('save').disabled).toBe(true)
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toHaveLength(0)
  })

  it('saves the whole scope list as one fenced mutation', async () => {
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], publish: 'internal' }] })
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toEqual([[
      { op: 'set', path: ['scopes'], value: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], publish: 'internal' }] },
    ]])
    expect(h.text()).toContain('saved')
  })

  it('keeps editing available when the host facts are unavailable, without guessing them', async () => {
    const h = await render({ scopes: [{ name: 'nexus' }] }, { storesFail: true })
    expect(h.text()).toContain('unavailableTitle')
    expect(h.text()).not.toContain('remoteConfigured')
    expect(h.button('save').disabled).toBe(false)
    // No host answer means no absolute path to offer: the copy affordance stays
    // hidden rather than copying a guessed "~/..." value.
    await h.expand(0)
    expect([...h.container.querySelectorAll('button')].map(button => button.textContent?.trim())).not.toContain('copy')
  })

  it('says so when the host answers the workspace endpoint with an error', async () => {
    // An older host replies "unknown endpoint": the page must degrade visibly
    // rather than present configuration-only blocks as if they were the registry.
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'] }] }, { workspacesFail: true })
    expect(h.text()).toContain('degradedWorkspaces')
    expect(h.text()).toContain('/work/nexus')
  })

  it('says so when the host has no workspace registry', async () => {
    // Degrading to configuration-only blocks is fine; claiming the user has no
    // workspaces is not.
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'] }] })
    expect(h.text()).toContain('degradedWorkspaces')
    expect(h.text()).toContain('noWorkspaceTitle')
    expect(h.text()).toContain('/work/nexus')
  })

  it('states the publication direction as a fact and never as a control', async () => {
    const h = await render({ scopes: [{ name: 'nexus', publish: 'internal' }] }, { stores: [store({ scope: 'nexus', publish: 'internal' })] })
    await h.expand(0)
    for (const input of h.container.querySelectorAll('input')) {
      expect(['internal', 'external']).not.toContain(input.value)
    }
    for (const control of h.container.querySelectorAll('button, input, select, textarea')) {
      expect(control.getAttribute('aria-label') ?? '').not.toContain('factPublish')
      expect(control.textContent ?? '').not.toContain('publishInternal')
    }
    // The only select on the page is the entry picker, and it is closed.
    expect(h.container.querySelectorAll('select')).toHaveLength(0)
    expect(h.text()).toContain('factPublish')
    expect(h.text()).toContain('publishInternal')
  })

  it('never guesses a publication direction the host could not prove', async () => {
    // A library nothing declares has no publish direction: the Host refuses every
    // write to it. Showing it as internal or external would be a guess the page
    // cannot support — and the misleading one is "internal".
    const h = await render({ scopes: [] }, {
      stores: [store({ scope: 'stray', declared: false, source: 'discovered', publishKnown: false, publish: 'external' })],
    })
    await act(async () => { h.button('actionDeclare').click() })
    await h.expand(0)
    expect(h.text()).toContain('publishUnknown')
    expect(h.text()).not.toContain('publishInternal')
    expect(h.text()).not.toContain('publishExternal')
  })

  it('offers a pure path probe and reports the resolved library', async () => {
    const h = await render({ scopes: [] })
    const probeInput = h.inputByPlaceholder('probePlaceholder')
    await act(async () => { typeInto(probeInput, '/probe') })
    await act(async () => { h.button('probeRun').click() })
    expect(h.rpcCalls).toContainEqual({ endpoint: MEMEX_RESOLVE_ENDPOINT, params: { path: '/probe' } })
    expect(h.text()).toContain(query)
  })

  it('does not repeat a derived library the workspace already shows', async () => {
    const h = await render({ scopes: [] }, {
      workspaces: registry([{ title: 'learning', path: '/home/u/Documents/learning', route: routeOf('documents-learning', '/home/u/Documents/learning') }]),
      stores: [
        store({ scope: 'documents-learning', declared: false, source: 'local' }),
        store({ scope: 'acceptance-probe', declared: false, source: 'discovered' }),
      ],
    })
    // The workspace block already names documents-learning; the undeclared list
    // carries only what no workspace accounts for.
    expect(h.text()).toContain('undeclaredTitle')
    expect(h.text()).toContain('acceptance-probe')
    expect(h.text()).not.toContain('documents-learning  /home/u/.dsh-memex/documents-learning')
  })

  it('lists libraries nothing declares and can stage a declaration for them', async () => {
    const h = await render({ scopes: [{ name: 'nexus' }] }, {
      stores: [
        store({ scope: 'nexus' }),
        store({ scope: 'stray', declared: false, source: 'discovered' }),
      ],
    })
    expect(h.text()).toContain('undeclaredTitle')
    await act(async () => { h.button('actionDeclare').click() })
    expect(h.text()).toContain('unsaved')
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toEqual([[
      { op: 'set', path: ['scopes'], value: [{ name: 'nexus' }, { name: 'stray' }] },
    ]])
  })

  it('cannot create a duplicate entry, because the picker never offers one', async () => {
    const h = await render(
      { scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], primary: true }, { name: 'flow', pathPrefixes: ['/work/flow'] }] },
      {
        workspaces: registry([{ title: 'nexus', path: '/work/nexus' }]),
        stores: [store({ scope: 'nexus' }), store({ scope: 'flow' })],
      },
    )
    await act(async () => { h.button('actionAttach').click() })
    const options = [...h.container.querySelectorAll('select option')].map(option => option.textContent ?? '')
    // The workspace's own entry is absent from the candidates: selecting it again
    // is how a duplicate name used to become reachable.
    expect(options.some(option => option.startsWith('nexus'))).toBe(false)
    expect(options.some(option => option.startsWith('flow'))).toBe(true)
    await h.choose('flow')
    expect(h.text()).not.toContain('conflictName')
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toEqual([[
      { op: 'set', path: ['scopes'], value: [
        { name: 'nexus', pathPrefixes: ['/work/nexus'], primary: true },
        { name: 'flow', pathPrefixes: ['/work/flow', '/work/nexus'] },
      ] },
    ]])
  })

  it('declares the derived primary when an undeclared workspace gets a second entry', async () => {
    // Declaring only the new entry would win the route outright: the resolver
    // stops deriving as soon as any declaration matches the directory.
    const h = await render({ scopes: [{ name: 'tools', pathPrefixes: ['/work/tools'] }] }, {
      workspaces: registry([{ title: 'learning', path: '/home/u/Documents/learning', route: routeOf('documents-learning', '/home/u/Documents/learning') }]),
      stores: [store({ scope: 'tools' })],
    })
    await act(async () => { h.button('actionAttach').click() })
    await h.choose('tools')
    expect(h.text()).toContain('stagedNotice')
    await act(async () => { h.button('save').click() })
    const value = (h.mutations[0] as Array<{ value: unknown }>)[0]!.value as unknown[]
    expect(value).toEqual([
      { name: 'tools', pathPrefixes: ['/work/tools', '/home/u/Documents/learning'] },
      { name: 'documents-learning', pathPrefixes: ['/home/u/Documents/learning'], primary: true },
    ])
  })

  it('turns the fallback off on an undeclared workspace and says what it staged', async () => {
    const h = await render({ scopes: [] }, {
      workspaces: registry([{ title: 'learning', path: '/home/u/Documents/learning', route: routeOf('documents-learning', '/home/u/Documents/learning') }]),
      stores: [store({ scope: 'documents-learning', declared: false, source: 'local' })],
    })
    const toggle = h.checkbox('fallbackLabel')
    expect(toggle.checked).toBe(true)
    await act(async () => { toggle.click() })
    expect(h.text()).toContain('stagedNotice')
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toEqual([[
      { op: 'set', path: ['scopes'], value: [
        { name: 'documents-learning', pathPrefixes: ['/home/u/Documents/learning'], primary: true, fallback: false },
      ] },
    ]])
  })

  it('switches memory off for one workspace, staging its derived primary', async () => {
    const h = await render({ scopes: [] }, {
      workspaces: registry([{ title: 'work-thing', path: '/home/u/work/thing', route: routeOf('work-thing', '/home/u/work/thing', { source: 'derived' }) }]),
      stores: [store({ scope: 'work-thing', declared: false, source: 'derived' })],
    })
    const toggle = h.checkbox('memoryLabel')
    expect(toggle.checked).toBe(true)
    await act(async () => { toggle.click() })
    expect(h.text()).toContain('stagedNotice')
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toEqual([[
      { op: 'set', path: ['scopes'], value: [
        { name: 'work-thing', pathPrefixes: ['/home/u/work/thing'], primary: true, memory: false },
      ] },
    ]])
  })

  it('folds memory-off workspaces into a collapsed group', async () => {
    const h = await render({
      scopes: [
        { name: 'work-thing', pathPrefixes: ['/home/u/work/thing'], memory: false },
        { name: 'nexus', pathPrefixes: ['/home/u/work/nexus'] },
      ],
    }, {
      workspaces: registry([
        { title: 'work-thing', path: '/home/u/work/thing' },
        { title: 'nexus', path: '/home/u/work/nexus' },
      ]),
      stores: [store({ scope: 'work-thing', memory: false }), store({ scope: 'nexus' })],
    })
    const blocks = () => [...h.container.querySelectorAll('section.dshmx-lib')].map(node => node.querySelector('.dshmx-ws-title')?.textContent)
    // Off by default: the block is not one of the main-list rows any more.
    expect(blocks()).toEqual(['nexus'])
    expect(h.text()).toContain('hiddenGroup (1)')
    // Its state is still stated, and one click away.
    expect(h.button('actionShow').getAttribute('aria-expanded')).toBe('false')
    await act(async () => { h.button('actionShow').click() })
    expect(blocks()).toEqual(['nexus', 'work-thing'])
    expect(h.text()).toContain('memoryHint')
    // Opening the group is a view state: nothing is written.
    expect(h.mutations).toHaveLength(0)
  })

  it('can switch memory back on from inside the folded group', async () => {
    const h = await render({ scopes: [{ name: 'work-thing', pathPrefixes: ['/home/u/work/thing'], memory: false }] }, {
      workspaces: registry([{ title: 'work-thing', path: '/home/u/work/thing' }]),
      stores: [store({ scope: 'work-thing', memory: false })],
    })
    await act(async () => { h.button('actionShow').click() })
    const toggle = h.checkbox('memoryLabel')
    expect(toggle.checked).toBe(false)
    await act(async () => { toggle.click() })
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toEqual([[
      { op: 'set', path: ['scopes'], value: [
        { name: 'work-thing', pathPrefixes: ['/home/u/work/thing'], memory: true },
      ] },
    ]])
  })

  it('shows no folded group when every workspace has memory on', async () => {
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/home/u/work/nexus'] }] }, {
      workspaces: registry([{ title: 'nexus', path: '/home/u/work/nexus' }]),
      stores: [store({ scope: 'nexus' })],
    })
    // An empty "Memory off (0)" heading would be noise, so there is none.
    expect(h.text()).not.toContain('hiddenGroup')
    expect([...h.container.querySelectorAll('button')].map(b => b.textContent?.trim())).not.toContain('actionShow')
  })

  it('turns the fallback entry off in both directions, on the primary entry', async () => {
    const h = await render({ scopes: [{ name: 'nexus', pathPrefixes: ['/work/nexus'] }] }, {
      workspaces: registry([{ title: 'nexus', path: '/work/nexus' }]),
      stores: [store({ scope: 'nexus' }), store({ scope: 'personal', publish: 'external' })],
    })
    // The fallback is an entry of the workspace, on by default, and its switch is
    // on the row rather than behind the disclosure: it is a state, not a detail.
    expect(h.text()).toContain('fallbackLabel')
    const toggle = h.checkbox('fallbackLabel')
    expect(toggle.checked).toBe(true)
    await act(async () => { toggle.click() })
    await act(async () => { h.button('save').click() })
    expect(h.mutations).toEqual([[
      { op: 'set', path: ['scopes'], value: [{ name: 'nexus', pathPrefixes: ['/work/nexus'], fallback: false }] },
    ]])
  })
})
