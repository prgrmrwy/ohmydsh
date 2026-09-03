/**
 * Client-side tests: position persistence, static markup accessibility and
 * the fixed settings information architecture.
 *
 * Rendering uses `renderToStaticMarkup` (the established pattern in this
 * repository) so the component contract is asserted without a full DOM.
 */

import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PET_SIZE,
  clampPosition,
  defaultPosition,
  readPosition,
  writePosition,
  POSITION_KEY,
} from '../src/client/position.js'
import { PET_CSS } from '../src/client/styles.js'
import { PET_SETTINGS_TABS, PetSettingsSection } from '../src/client/settings.js'
import { PetOverlay } from '../src/client/overlay.js'

// Pet never polls on render; fetch is stubbed so effects cannot escape.
vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: true, data: {} }) })))

const viewport = { width: 1280, height: 800 }

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

describe('overlay position persistence', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    storage = memoryStorage()
  })

  it('defaults to a visible bottom-right position', () => {
    const position = defaultPosition(viewport)

    expect(position.x).toBeLessThanOrEqual(viewport.width - PET_SIZE)
    expect(position.y).toBeLessThanOrEqual(viewport.height - PET_SIZE)
    expect(position.x).toBeGreaterThanOrEqual(0)
  })

  it('round-trips a dragged position across a reload', () => {
    writePosition({ x: 120, y: 240 }, viewport, storage)

    expect(readPosition(viewport, storage)).toEqual({ x: 120, y: 240 })
    expect(storage.map.has(POSITION_KEY)).toBe(true)
  })

  it('clamps a stored position into a smaller viewport', () => {
    writePosition({ x: 1200, y: 700 }, viewport, storage)

    // The window shrank; Pet must not be stranded off-screen.
    const restored = readPosition({ width: 400, height: 300 }, storage)

    expect(restored.x).toBeLessThanOrEqual(400 - PET_SIZE)
    expect(restored.y).toBeLessThanOrEqual(300 - PET_SIZE)
  })

  it('never allows a negative position', () => {
    expect(clampPosition({ x: -500, y: -500 }, viewport)).toEqual({ x: 0, y: 0 })
  })

  it('falls back to the default for corrupt storage', () => {
    storage.map.set(POSITION_KEY, 'not json')
    expect(readPosition(viewport, storage)).toEqual(defaultPosition(viewport))

    storage.map.set(POSITION_KEY, JSON.stringify({ x: 'left', y: null }))
    expect(readPosition(viewport, storage)).toEqual(defaultPosition(viewport))

    storage.map.set(POSITION_KEY, JSON.stringify({ x: Infinity, y: 0 }))
    expect(readPosition(viewport, storage)).toEqual(defaultPosition(viewport))
  })

  it('survives storage that refuses writes', () => {
    const hostile = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }

    // Dragging must keep working even when persistence fails.
    expect(() => writePosition({ x: 10, y: 10 }, viewport, hostile)).not.toThrow()
  })

  it('tolerates a missing storage implementation', () => {
    expect(readPosition(viewport, undefined)).toEqual(defaultPosition(viewport))
  })
})

describe('overlay markup and accessibility', () => {
  it('renders an accessible, labelled mascot control', () => {
    const markup = renderToStaticMarkup(
      createElement(PetOverlay, { currentSource: undefined }),
    )

    expect(markup).toContain('aria-label="DSH Pet"')
    expect(markup).toContain('type="button"')
    // A real button is keyboard focusable and activatable by default.
    expect(markup).toContain('class="dshpet-mascot"')
  })

  it('positions itself as a fixed overlay surface', () => {
    const markup = renderToStaticMarkup(
      createElement(PetOverlay, { currentSource: undefined }),
    )

    expect(markup).toContain('dshpet-root')
    expect(markup).toMatch(/left:\d+px/)
    expect(markup).toMatch(/top:\d+px/)
  })
})

describe('overlay styles', () => {
  it('only defines Pet-owned class names', () => {
    const selectors = PET_CSS.match(/\.[a-zA-Z][\w-]*/g) ?? []

    for (const selector of selectors) {
      expect(selector.startsWith('.dshpet-')).toBe(true)
    }
  })

  it('opts into pointer events only on the Pet surface', () => {
    // The shell.overlay layer is click-through; Pet re-enables events for
    // itself alone so it never blocks the app underneath.
    expect(PET_CSS).toContain('pointer-events:auto')
    expect(PET_CSS).toContain('.dshpet-badge{')
  })

  it('uses DSH theme tokens with literal fallbacks for dark and light', () => {
    expect(PET_CSS).toContain('var(--dsw-alias-bg-layer-1,')
    expect(PET_CSS).toContain('var(--dsw-alias-label-primary,')
    expect(PET_CSS).toContain('var(--dsw-alias-brand-primary,')
  })

  it('references only DSW tokens the installed DSH actually defines', async () => {
    const { readFile, readdir } = await import('node:fs/promises')
    const root = path.resolve(__dirname, '..', '..', '..', 'node_modules', '@deepseek-ai')

    // Build the real vocabulary from the shipped client bundles. The previous
    // assertion only echoed the names Pet itself used, so four invented tokens
    // (`bg-float`, `primary`, `danger`, `line-divider`) passed for weeks while
    // silently falling back to hard-coded colors and ignoring the theme.
    const defined = new Set<string>()
    for (const entry of await readdir(root)) {
      const bundle = path.join(root, entry, 'lib', 'client.js')
      const source = await readFile(bundle, 'utf8').catch(() => undefined)
      if (source === undefined) continue
      for (const match of source.matchAll(/--dsw-[a-z0-9-]+/g)) defined.add(match[0])
    }
    expect(defined.size).toBeGreaterThan(20)

    const used = new Set([...PET_CSS.matchAll(/--dsw-[a-z0-9-]+/g)].map(m => m[0]))
    expect([...used].filter(token => !defined.has(token))).toEqual([])
  })

  it('provides a visible keyboard focus indicator', () => {
    expect(PET_CSS).toContain('.dshpet-mascot:focus-visible')
    expect(PET_CSS).toContain('.dshpet-wheel-item:focus-visible')
  })

  it('adapts to narrow viewports', () => {
    expect(PET_CSS).toContain('@media (max-width:520px)')
  })

  it('disables touch scrolling interference while dragging', () => {
    expect(PET_CSS).toContain('touch-action:none')
  })
})

describe('settings information architecture', () => {
  it('exposes exactly the three stable tabs', () => {
    expect(PET_SETTINGS_TABS).toEqual(['general', 'skills', 'diagnostics'])
  })

  it('renders an accessible tablist', () => {
    const markup = renderToStaticMarkup(createElement(PetSettingsSection, {}))

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('role="tab"')
    expect(markup).toContain('role="tabpanel"')
    // Each tab is wired to its panel for screen readers.
    expect(markup).toContain('aria-controls="dshpet-panel-general"')
    expect(markup).toContain('aria-labelledby="dshpet-tab-general"')
  })

  it('defaults to General and supports deep-linking a tab', () => {
    const general = renderToStaticMarkup(createElement(PetSettingsSection, {}))
    expect(general).toContain('id="dshpet-panel-general"')

    const skills = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'skills' as const }),
    )
    expect(skills).toContain('id="dshpet-panel-skills"')
  })

  it('states that Skill import paths are Host paths, not browser paths', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'skills' as const }),
    )

    expect(markup).toContain('dsh web')
    expect(markup).toContain('不是你当前浏览器所在的机器')
  })

  it('states that Pet follows the DSH default model instead of its own', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'general' as const }),
    )

    // Pet executors are ordinary Agents, so the model is the Host's default.
    // There is no Pet-owned copy for the user to set or keep in sync.
    expect(markup).toContain('跟随 DSH')
    expect(markup).not.toMatch(/type="password"/)
    expect(markup.toLowerCase()).not.toContain('api key')
  })

  it('offers no editable provider or model control', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'general' as const }),
    )

    // A writable field here would reintroduce the divergence this removed:
    // a Pet-private selection silently disagreeing with the Host default.
    expect(markup).not.toContain('name="providerId"')
    expect(markup).not.toMatch(/<input[^>]*value="[^"]*"[^>]*\/>[\s\S]{0,40}Model/)
  })

  it('documents channel secrets as future protected references only', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'diagnostics' as const }),
    )

    expect(markup).toContain('not part of this phase')
    expect(markup).toContain('never displayed')
  })

})

describe('client program is actually typechecked', () => {
  it('compiles every client source file, not just wire.ts', async () => {
    const { execFileSync } = await import('node:child_process')
    const output = execFileSync(
      'npx',
      ['tsc', '-p', 'tsconfig.client.json', '--showConfig'],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' },
    )
    const config = JSON.parse(output) as { files?: string[] }
    const files = config.files ?? []

    // Regression guard: the parent tsconfig excludes `src/client`, and that
    // exclude is INHERITED and beats this config's `include`. When that
    // happened the client program compiled only `wire.ts`, so `ctx` was `any`
    // and a wrong slot-registration API shipped without a type error.
    for (const name of ['index.tsx', 'overlay.tsx', 'settings.tsx', 'api.ts', 'position.ts']) {
      expect(files.some(file => file.endsWith(`/client/${name}`))).toBe(true)
    }
  }, 60_000)

  it('declares the slot-contract packages it imports types from', async () => {
    const { readFile } = await import('node:fs/promises')
    const pkg = JSON.parse(
      await readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
    ) as Record<string, Record<string, string> | undefined>
    const declared = { ...pkg['peerDependencies'], ...pkg['devDependencies'] }

    // Without these, the `SlotMap` augmentations for `shell.overlay` and
    // `settings.section` never load and every slot key goes unchecked.
    expect(declared['@deepseek-ai/dsh-client-ui-layout']).toBeDefined()
    expect(declared['@deepseek-ai/dsh-client-ui-settings']).toBeDefined()
    expect(declared['@deepseek-ai/dsh-client-ui-slots']).toBeDefined()
  })
})

describe('client reads DSH contracts, not invented shapes', () => {
  it('resolves the current source through getSnapshot and byId', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'index.tsx'),
      'utf8',
    )

    // `sessions.list` is an ObservableSnapshot: reading `.current` off the
    // feed object yields undefined, which made Pet believe there was never an
    // active session.
    expect(source).toContain('ctx.sessions.list.getSnapshot()')
    expect(source).toContain('ctx.workspaces.list.getSnapshot()')
    // The list is keyed by id, not an `items` array of sessions.
    expect(source).toContain('sessionState.byId[currentId]')
    // WorkspaceView identifies itself with `workspaceId`.
    expect(source).toContain('workspace.workspaceId')
    // Untyped service lookups defeat the compiler; the typed faces are used.
    expect(source).not.toContain("ctx.get('sessions')")
    expect(source).not.toContain("ctx.get('workspaces')")
  })

  it('ships no control for a settings API DSH does not expose', async () => {
    const { readFile } = await import('node:fs/promises')
    const clientDir = path.resolve(__dirname, '..', 'src', 'client')
    const entry = await readFile(path.join(clientDir, 'index.tsx'), 'utf8')
    const overlay = await readFile(path.join(clientDir, 'overlay.tsx'), 'utf8')

    // `openSection` belongs to the settings ONBOARDING slot; a plugin cannot
    // call it. A "Settings" button wired to an invented API would silently do
    // nothing — so Pet ships no such control, and no longer carries a hint
    // that just restated where the panel lives.
    expect(entry).not.toContain('openSettings')
    expect(overlay).not.toContain('openSettings')
    expect(overlay).not.toContain('Manage in Settings')
  })

  it('registers slots through inject with the two-argument register form', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'index.tsx'),
      'utf8',
    )

    expect(source).toContain("ctx.slots.inject('shell.overlay'")
    expect(source).toContain("ctx.slots.inject('settings.section'")
    expect(source).toContain("name: 'shell.overlay' as const")
    // The old three-argument form throws at load.
    expect(source).not.toMatch(/register\(\s*'shell\.overlay'/)
  })
})

describe('task panel follows the change feed instead of polling data routes', () => {
  it('reloads only when the Host reports a newer generation', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The cheap status route carries the generation; the expensive task list
    // is refetched only when that generation moves. Fetching tasks on a timer
    // would be the polling the contract forbids.
    expect(overlay).toContain('petApi.status(seen)')
    expect(overlay).toContain('status.stale')
    expect(overlay).toContain('seen = status.generation')
    expect(overlay).not.toMatch(/setInterval\([^)]*petApi\.tasks/)
  })

  it('sends the seen generation so the Host can answer staleness', async () => {
    const { readFile } = await import('node:fs/promises')
    const api = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'api.ts'),
      'utf8',
    )

    expect(api).toContain('seenGeneration')
    expect(api).toContain('readonly generation: number')
    expect(api).toContain('readonly stale: boolean')
  })
})


describe('radial menu honors shortcut visibility', () => {
  it('renders only capabilities marked as shortcuts', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Without this filter the Settings toggle silently does nothing.
    expect(overlay).toContain('capability.showAsShortcut')
    expect(overlay).toContain('capability.showAsShortcut')
    expect(overlay).not.toContain('capabilities.map(')
  })
})


describe('configured behavior is applied, not just displayed', () => {
  it('starts a new Task unattached when the policy is none', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The policy was persisted and shown but never applied, so choosing
    // `none` had no effect on how a Task actually started.
    expect(overlay).toContain("config.defaultContextPolicy === 'none'")
    expect(overlay).toContain('setSourceRemoved(true)')
  })

  it('lets the user change the policy rather than only reading it', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    expect(settings).toContain('defaultContextPolicy: next')
    expect(settings).toContain("value: 'none'")
  })

})

describe('task panel can answer a waiting Invocation', () => {
  it('offers an answer input only while a Task waits for the user', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The Host route existed and the spec requires the affordance, but the
    // panel previously had only cancel/retry/archive — a waiting Invocation
    // was unanswerable from Pet.
    expect(overlay).toContain("task.status === 'waiting-user' ? (")
    expect(overlay).toContain('.answer(task.id, text)')
    expect(overlay).toContain('dshpet-answer')
    // Labelled for assistive technology.
    expect(overlay).toContain('aria-label={`Answer the question waiting in')
  })
})

describe('the Task row is the only navigation control', () => {
  it('opens the executor session and offers nothing destructive', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The whole row navigates. Archiving belongs in the session, where
    // `reconcileArchives` already observes it; a destructive control in a
    // hover panel only invites misclicks.
    expect(overlay).toContain("props.openSession?.(task.executorSessionId)")
    expect(overlay).not.toContain('petApi.archive(')
    expect(overlay).not.toContain('petApi.cancel(')
    expect(overlay).not.toContain('Open source')
  })

  it('reaches the row from the keyboard', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // A clickable div is invisible to keyboard users without this.
    expect(overlay).toContain('role="button"')
    expect(overlay).toContain('tabIndex={0}')
  })
})

describe('task panel groups by source with a current-source view', () => {
  it('offers Current, All and Archived views', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The spec requires the current source's Task first, with a switch to
    // other sources and archived Tasks; the panel previously had only
    // active/archived and no notion of "current".
    expect(overlay).toContain("useState<'current' | 'all' | 'archived'>('current')")
    expect(overlay).toContain('>\n          Current\n        </button>')
    expect(overlay).toContain('>\n          All\n        </button>')
  })

  it('scopes the current view by the same scope key the Host routes on', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    expect(overlay).toContain('`session:${props.currentSource.sessionId}`')
    expect(overlay).toContain('`workspace:${props.currentSource.workspaceId}`')
    expect(overlay).toContain("'independent:web:default'")
    expect(overlay).toContain('task.scopeKey === currentScopeKey')
    // The executor session must never be treated as a source.
    expect(overlay).not.toContain('scopeKey === task.executorSessionId')
  })

  it('labels each Task by its source kind when listing all sources', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )
    expect(overlay).toContain('${task.sourceKind}: ${task.sourceTitle')
  })
})

describe('capability menu is reachable and legible without a pointer', () => {
  it('opens on focus, the keyboard equivalent of hover', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Previously the menu opened only on mouseEnter, so a keyboard user could
    // never reach the capabilities.
    expect(overlay).toContain('onFocus={() => {')
    expect(overlay).toContain('onBlur={event => {')
    // Moving focus between the mascot and a menu item must not collapse it.
    expect(overlay).toContain('!event.currentTarget.contains(event.relatedTarget)')
  })

  it('binds each disabled reason as an accessible description', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // `title` alone is not reliably announced by assistive technology.
    expect(overlay).toContain('aria-describedby={reason !== undefined')
    expect(overlay).toContain('id={`${capability.id}-reason`}')
  })

  it('announces a degraded Host instead of hiding it in a tooltip', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    expect(overlay).toContain('role="status"')
    expect(overlay).toContain('Pet 未就绪：')
    expect(overlay).toContain('aria-hidden="true"')
  })

  it('closes the menu with Escape from anywhere on the surface', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )
    expect(overlay).toContain("if (event.key === 'Escape') setMode('closed')")
  })

  it('provides a visually hidden utility class for announced-only text', async () => {
    const { PET_CSS } = await import('../src/client/styles.js')
    expect(PET_CSS).toContain('.dshpet-visually-hidden')
    // Must stay in the accessibility tree, so `display:none` is wrong here.
    expect(PET_CSS).not.toMatch(/\.dshpet-visually-hidden\{[^}]*display:none/)
  })
})

describe('Pet stays inside React\'s event delegation container', () => {
  it('never re-parents its node out of the mount container', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // React 18 delegates events at the mount container. Moving the node to
    // `document.body` silently stops every synthetic handler — hover, drag
    // and click all die while the element still renders and looks correct.
    expect(overlay).not.toContain('document.body.appendChild')
  })

  it('positions absolutely within the shell overlay layer', () => {
    // The layer is inset 0 over a full-height frame, so it already spans the
    // visible area; escaping it bought nothing and cost every interaction.
    expect(PET_CSS).toContain('.dshpet-root{position:absolute')
    expect(PET_CSS).not.toContain('.dshpet-root{position:fixed')
  })

  it('measures its containing layer rather than the window', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Clamping against the window would let Pet sit past the layer's edge.
    expect(overlay).toContain("querySelector('[data-shell-overlay]')")
    expect(overlay).toContain('ResizeObserver')
  })

  it('keeps the mascot and the clamp size in agreement', async () => {
    const { readFile } = await import('node:fs/promises')
    const position = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'position.ts'),
      'utf8',
    )
    const declared = /PET_SIZE = (\d+)/.exec(position)?.[1]

    expect(declared).toBeDefined()
    expect(PET_CSS).toContain(`.dshpet-root{position:absolute;z-index:999;width:${declared}px`)
    expect(PET_CSS).toContain(`width:${declared}px;height:${declared}px`)
  })
})

describe('settings nav glyph stays scoped to Pet\'s own row', () => {
  it('paints the mascot emoji and hides the fallback gear', async () => {
    const { PET_SETTINGS_NAV_CSS, PET_SETTINGS_NAV_MARKER } = await import(
      '../src/client/settings-nav-icon.js'
    )

    // DSH 0.1.x has no icon field on `settings.section`, so a third-party row
    // renders the shell's fallback gear until it marks itself.
    expect(PET_SETTINGS_NAV_CSS).toContain(`[${PET_SETTINGS_NAV_MARKER}]`)
    expect(PET_SETTINGS_NAV_CSS).toContain("content:'🐾'")
    expect(PET_SETTINGS_NAV_CSS).toContain('svg:first-child{display:none}')
  })

  it('selects nothing beyond its own marker attribute', async () => {
    const { PET_SETTINGS_NAV_CSS, PET_SETTINGS_NAV_MARKER } = await import(
      '../src/client/settings-nav-icon.js'
    )

    // Every selector must be anchored on the owned marker; a bare `nav button`
    // rule would restyle every other plugin's row too.
    const selectors = PET_SETTINGS_NAV_CSS.split('}')
      .map(block => block.split('{')[0]?.trim() ?? '')
      .filter(selector => selector.length > 0)
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      expect(selector.startsWith(`[${PET_SETTINGS_NAV_MARKER}]`)).toBe(true)
    }
  })

  it('marks only the button whose text matches the label, and cleans up', async () => {
    const { registerPetSettingsNavIcon, PET_SETTINGS_NAV_MARKER } = await import(
      '../src/client/settings-nav-icon.js'
    )
    const { JSDOM } = await import('jsdom').catch(() => ({ JSDOM: undefined }) as never)
    if (JSDOM === undefined) return

    const dom = new JSDOM(
      '<body><div role="dialog"><nav>' +
        '<button>General</button><button>Pet</button><button>Plugins</button>' +
        '</nav></div></body>',
    )
    const priorDocument = globalThis.document
    const priorObserver = globalThis.MutationObserver
    Object.defineProperty(globalThis, 'document', {
      value: dom.window.document,
      configurable: true,
    })
    globalThis.MutationObserver = dom.window.MutationObserver

    try {
      const dispose = registerPetSettingsNavIcon(() => 'Pet')
      const marked = [...dom.window.document.querySelectorAll(`[${PET_SETTINGS_NAV_MARKER}]`)]
      expect(marked.map(node => node.textContent)).toEqual(['Pet'])

      dispose()
      expect(dom.window.document.querySelectorAll(`[${PET_SETTINGS_NAV_MARKER}]`)).toHaveLength(0)
    } finally {
      Object.defineProperty(globalThis, 'document', {
        value: priorDocument,
        configurable: true,
      })
      globalThis.MutationObserver = priorObserver
    }
  })
})

describe('hover, drag and dismissal behave independently', () => {
  it('closes the hover menu on leave but not the clicked panel', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Hover owns the MENU only. The panel is opened deliberately, so a
    // pointer drifting away must not evaporate it — and collapsing it here is
    // why Pet appeared to stay open forever after a capability run.
    // Hover owns the wheel only; the panel is click-opened and must not
    // evaporate when the pointer drifts. Closing is now distance-based, so
    // assert the rule rather than a `mouseleave` handler.
    expect(overlay).toContain("> wheelRadius) setMode('closed')")
    expect(overlay).not.toContain("if (mode !== 'closed') setMode('closed')")
  })

  it('dismisses the panel on an outside pointer press', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Since hover no longer closes the panel, it needs a click-driven exit.
    expect(overlay).toContain("document.addEventListener('pointerdown'")
    expect(overlay).toContain('node.contains(event.target as Node)')
  })

})

describe('settings surface follows the DSH type scale', () => {
  it('uses the official font tokens instead of ad-hoc sizes', () => {
    // Each `--dsw-font-*` token carries its own line-height; declaring a bare
    // font-size left the vertical rhythm to the browser default, which is the
    // main reason the panel read as cramped and inconsistent.
    expect(PET_CSS).toContain('var(--dsw-font-s-14')
    expect(PET_CSS).toContain('var(--dsw-font-xxs-12')
  })

  it('uses the business accent for focus rings, not the neutral brand token', () => {
    // `--dsw-alias-brand-primary` resolves to #0f1115 (near-black), so using
    // it as a focus ring with a blue fallback meant the ring changed colour
    // depending on whether the token resolved.
    expect(PET_CSS).toContain('var(--dsw-alias-state-business-primary')
    expect(PET_CSS).not.toContain('var(--dsw-alias-brand-primary,#3370ff)')
  })

  it('gives every settings tab the same group rhythm', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )
    const titles = [...settings.matchAll(/className="dshpet-group-title"/g)].length
    const groups = [...settings.matchAll(/className="dshpet-group"/g)].length

    // Previously only General wrapped its sections, so the other three tabs
    // had no padding, gap or divider at all.
    expect(groups).toBe(titles)
  })

  it('styles every settings input rather than leaving a bare control', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )
    const inputs = [...settings.matchAll(/<input\b/g)].length
    // Allow additional owned modifiers alongside the base class.
    const styled = [...settings.matchAll(/<input\s+className="dshpet-input[^"]*"/g)].length
    expect(styled).toBe(inputs)
  })
})

describe('settings expose the configuration they claim to', () => {
  it('offers the optional Pet agent preset', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Tasks 4.3 and 10.2 both require it; the Host accepted `agentPreset` all
    // along but no control ever let a user set it.
    expect(settings).toContain('Agent 预设')
    expect(settings).toContain('agentPreset: next')
  })

  it('applies the accent through a broadcast, not just storage', async () => {
    const { readFile } = await import('node:fs/promises')
    const [accent, overlay] = await Promise.all([
      readFile(path.resolve(__dirname, '..', 'src', 'client', 'accent.ts'), 'utf8'),
      readFile(path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'), 'utf8'),
    ])

    // The overlay reads the accent once into React state, so writing storage
    // alone would appear to do nothing until the page was reloaded.
    expect(accent).toContain('PET_ACCENT_EVENT')
    expect(overlay).toContain('PET_ACCENT_EVENT')
  })

  it('offers a Host directory picker for Skill import', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // The path is a HOST path, so a browser file input would be wrong — it
    // yields the user's own machine. A deployment without the native
    // capability simply gets no picker and keeps typing.
    expect(settings).toContain('directoryPicker')
    expect(settings).toContain('浏览')
    expect(settings).not.toContain('type="file"')
  })

  it('shows bindings read-only until the user chooses to edit', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    expect(settings).toContain('setEditing(true)')
    expect(settings).toContain('dshpet-readonly')
    // A rejected save keeps the form open with the input preserved.
    expect(settings).toContain('setEditing(false)')
  })

  it('renders diagnostics as labelled facts instead of a JSON dump', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    expect(settings).toContain('<Fact label="生命周期"')
    expect(settings).not.toContain("JSON.stringify(data?.['lifecycle']")
  })
})

describe('stored settings share one read-only-until-edit pattern', () => {
  it('routes every persisted value through the shared field', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Agent preset and default context policy are the stored values that
    // remain, so each shows its current setting until the user opts into
    // editing.
    const fields = [...settings.matchAll(/<StoredField/g)].length
    expect(fields).toBeGreaterThanOrEqual(2)
  })

  it('renders the panel in Chinese', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'general' as const }),
    )

    expect(markup).toContain('模型')
    expect(markup).toContain('Agent 预设')
    expect(markup).toContain('桌宠配色')
    // The tab strip is Chinese too.
    expect(markup).toContain('通用')
  })
})



describe('Skill file health is explained without internal jargon', () => {
  it('names the control by what it does, not by its implementation', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'skills' as const }),
    )

    // "Rebuild projection" describes Pet's internals. A user only needs to
    // know these are the Skill links the executor reads.
    expect(markup).toContain('重新生成 Skill 链接')
    expect(markup).not.toContain('Rebuild projection')
    expect(markup).toContain('Skill 文件状态')
  })

  it('says these links are self-maintained so the button is rarely needed', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'skills' as const }),
    )

    expect(markup).toContain('你不需要管它')
    expect(markup).toContain('当前一切正常')
  })

  it('states the limit: repair fixes links, not tampered content', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'skills' as const }),
    )

    // Rebuild deliberately refuses to republish a revision whose digest no
    // longer matches, so the panel must not imply it fixes everything.
    expect(markup).toContain('只修复链接本身')
    expect(markup).toContain('重新加入')
  })
})

describe('Skill install and upgrade semantics are stated', () => {


  it('says import does not auto-enable', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'skills' as const }),
    )
    expect(markup).toContain('不会自动启用')
  })
})

describe('Skills are linked, not copied', () => {
  it('states that a registered Skill stays live', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'skills' as const }),
    )

    // Linking is the whole model: editing the source takes effect at once,
    // and removing a Skill must not touch the user's own directory.
    expect(markup).toContain('直接链接到你给的目录')
    expect(markup).toContain('立即生效')
    expect(markup).toContain('不会删除你的目录')
  })

  it('warns that the Skill breaks if its directory disappears', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'skills' as const }),
    )
    expect(markup).toContain('目录被删除或移走')
  })
})

describe('directory selection degrades to the in-app browser', () => {
  it('falls through when the OS picker is unavailable', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // `host.pickDirectory` needs the `native` capability; a deployment that
    // only serves `browse` rejects it. Treating that rejection as an error
    // left the Browse button apparently dead.
    expect(settings).toContain('directoryLister')
    expect(settings).toContain('setBrowsing')
    expect(settings).toContain('此部署不支持目录选择')
  })

  it('swallows the native rejection instead of surfacing it', async () => {
    const { readFile } = await import('node:fs/promises')
    const entry = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'index.tsx'),
      'utf8',
    )
    expect(entry).toContain('pick({}).catch(() => undefined)')
    expect(entry).toContain('setDirectoryLister')
  })
})

describe('the Agent preset is chosen, not typed', () => {
  it('offers the presets this Host actually provides', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // A typed name could refer to a composition that does not exist.
    expect(settings).toContain('presetOptions')
    // Unset means Pet's own executor preset, not the Host default.
    expect(settings).toContain('config?.agentPreset ?? PET_EXECUTOR_PRESET')
  })
})

describe('bindings are gone, not hidden', () => {
  it('drops the tab and its routes entirely', async () => {
    const { readFile } = await import('node:fs/promises')
    const [settings, wire, api] = await Promise.all([
      readFile(path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'), 'utf8'),
      readFile(path.resolve(__dirname, '..', 'src', 'wire.ts'), 'utf8'),
      readFile(path.resolve(__dirname, '..', 'src', 'client', 'api.ts'), 'utf8'),
    ])

    // Nothing read the bindings, so the page configured values that could
    // never take effect. A dead setting is worse than an absent one.
    expect(settings).not.toContain('BindingsTab')
    expect(wire).not.toContain('bindingsUpdate')
    expect(api).not.toContain('updateBinding')
  })
})

describe('preset terminology cannot be confused with Pet context', () => {
  it('says the default preset restricts Skill visibility', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'general' as const }),
    )

    // Pet now ships its own executor preset: `standard` would load
    // `skill-filesystem` and expose every globally installed Skill.
    expect(markup).toContain('Pet 执行会话')
    expect(markup).toContain('不加载本地 Skill 发现')
    // Switching away widens authorization, so the panel must say so.
    expect(markup).toContain('放宽授权范围')
  })

  it('says Pet context applies regardless of the chosen preset', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'general' as const }),
    )

    // Standing instructions plus the per-Invocation envelope are what
    // establish Pet's context — never the preset.
    expect(markup).toContain('常驻指令')
    expect(markup).toContain('与这里选什么预设无关')
  })
})

describe('Host directory APIs are read from the right connection face', () => {
  it('uses connection.api.host, not connection.rpc.host', async () => {
    const { readFile } = await import('node:fs/promises')
    const entry = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'index.tsx'),
      'utf8',
    )

    // `host` hangs off the IApiClient face (`connection.api`). Reading
    // `connection.rpc.host` yields `undefined`, so BOTH the OS picker and the
    // in-app browser degrade to "this deployment does not support directory
    // selection" even where listDirectory works fine.
    expect(entry).toContain('connection?.api?.host?.pickDirectory')
    expect(entry).toContain('connection?.api?.host?.listDirectory')
    expect(entry).not.toContain('connection?.rpc?.host')
  })

  it('matches the face the installed client library actually exposes', async () => {
    const { readFile } = await import('node:fs/promises')
    const declared = await readFile(
      path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        'node_modules',
        '@deepseek-ai',
        'dsh-host-apiproxy',
        'lib',
        'types',
        'fetch',
        'client.d.ts',
      ),
      'utf8',
    )

    // Pin the assumption to the real contract rather than to memory.
    expect(declared).toContain('listDirectory(payload: RequestPayload<\'host.listDirectory\'>')
  })
})

describe('the directory browser reads as a left-aligned list', () => {
  it('beats the centering settings-action rule on specificity', () => {
    // `.dshpet-settings .dshpet-action` centers its label with two levels of
    // specificity, so a single-class override loses and the folder names
    // render centered.
    expect(PET_CSS).toContain('.dshpet-settings .dshpet-browser-entry{justify-content:flex-start')
    expect(PET_CSS).toContain('.dshpet-settings .dshpet-crumbs{justify-content:flex-start}')
  })

  it('lays a folder row out as icon, name, chevron', () => {
    expect(PET_CSS).toContain('.dshpet-browser-name{flex:1')
    // A long name must truncate rather than push the chevron out of view.
    expect(PET_CSS).toContain('text-overflow:ellipsis')
  })
})

describe('the glyph follows the same stored-setting pattern', () => {
  it('is read-only until edited, and offers a reset', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Every persisted value in this panel behaves the same way; a bare always
    // editable input was the odd one out.
    expect(settings).toContain('label="图标"')
    expect(settings).toContain('onReset')
    expect(settings).not.toContain('dshpet-glyph-input')
  })

  it('renders a reset control inside the shared field', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )
    const field = settings.slice(settings.indexOf('function StoredField'))

    expect(field).toContain('恢复默认')
    // Shown only while editing, next to save and cancel.
    expect(field.indexOf('恢复默认')).toBeGreaterThan(field.indexOf('取消'))
  })
})

describe('the directory browser starts from the typed path', () => {
  it('opens at the field value instead of always the Host home', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Calling the lister with no argument always lists the Host home, so a
    // path already in the field was ignored and the user had to navigate back
    // to it by hand.
    expect(settings).toContain('await directoryLister?.(typed)')
  })

  it('falls back to the default listing when the typed path is unreadable', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // A half-typed or deleted path must not prevent browsing entirely.
    expect(settings).toContain('(await directoryLister?.())')
  })

  it('keeps the field in step with the browsed directory', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Otherwise the field and the listing disagree, and Inspect would read a
    // different directory than the one on screen.
    expect([...settings.matchAll(/setPath\(next\.path\)/g)]).toHaveLength(2)
  })
})

describe('the import preview reflects the link model', () => {
  it('shows the directory it will link, not a removed digest', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Digests went away with the copy-based model, so the preview rendered a
    // literal "Digest: undefined".
    expect(settings).not.toContain("preview['digest']")
    expect(settings).toContain("preview['canonicalSourcePath']")
  })

  it('warns that a linked Skill stays live', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // The trust warning must reflect linking: later edits to that directory
    // take effect without any further confirmation.
    expect(settings).toContain('只加入你信任的目录')
    expect(settings).toContain('立即生效')
  })
})

describe('Settings caps enabled Skills at the wheel capacity', () => {
  it('blocks enabling past the cap and explains why', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // Enabling past the cap would leave a Skill enabled but invisible, which
    // reads as a bug rather than a limit.
    expect(settings).toContain('disabled={!enabled && atCapacity}')
    expect(settings).toContain('已达轮盘容量上限')
  })

  it('never blocks disabling', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // `!enabled &&` matters: at capacity the user must still be able to turn
    // one off, or the state would be unrecoverable.
    expect(settings).not.toContain('disabled={atCapacity}')
  })
})

describe('the wheel container does not swallow pointer events', () => {
  it('makes only the slices and mascot interactive', async () => {
    const { readFile } = await import('node:fs/promises')
    const styles = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'styles.ts'),
      'utf8',
    )

    // The wheel's box is far larger than the mascot. Without this it would
    // cover the page underneath even while collapsed.
    expect(styles).toContain('.dshpet-wheel{')
    const wheel = styles.slice(styles.indexOf('.dshpet-wheel{'))
    expect(wheel.slice(0, 200)).toContain('pointer-events:none')
    expect(styles).toContain('.dshpet-slot{pointer-events:auto')
  })
})

describe('the Task row reads as clickable', () => {
  it('shows a pointer cursor and a hover state', async () => {
    const { readFile } = await import('node:fs/promises')
    const styles = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'styles.ts'),
      'utf8',
    )
    const rule = styles.slice(styles.indexOf('.dshpet-task{'))

    // The whole row navigates; the default arrow makes it look inert.
    expect(rule.slice(0, 200)).toContain('cursor:pointer')
    expect(styles).toContain('.dshpet-task:hover')
  })

  it('does not navigate when an inner control is used', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The row hosts the answer field: navigating on every click inside it
    // would steal focus mid-typing.
    expect(overlay).toContain("closest('input, button, textarea')")
    expect(overlay).toContain('if (event.target !== event.currentTarget) return')
  })
})

describe('the executor preset falls back on a blank value', () => {
  it('treats an empty stored preset as unset', async () => {
    const { readFile } = await import('node:fs/promises')
    const entry = await readFile(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')

    // `??` only catches `undefined`. An empty string reached DSH verbatim and
    // broke session resume with `preset "" not found`.
    expect(entry).toContain("repository.global.agentPreset.trim() === ''")
    expect(entry).toContain('PET_EXECUTOR_PRESET')
  })

  it('heals a stored blank preset at startup', async () => {
    const { readFile } = await import('node:fs/promises')
    const entry = await readFile(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')

    // The value is invisible in the panel, so a user cannot clear it; without
    // this, every existing Task stays unusable.
    expect(entry).toContain("repository.global.agentPreset?.trim() === ''")
    expect(entry).toContain('const { agentPreset: _blank, ...rest } = current')
  })
})

describe('the wheel is reachable above the mascot box', () => {
  it('drops the rectangular menu hover bridge', async () => {
    const { readFile } = await import('node:fs/promises')
    const styles = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'styles.ts'),
      'utf8',
    )

    // That bridge was a 268px strip anchored to the root. With the wheel it
    // lies ON TOP of the slices and swallows their clicks — which is why a
    // capability sometimes ran and sometimes just closed the wheel.
    expect(styles).not.toContain('left:-260px')
    expect(styles).not.toContain('[data-open="true"]::before')
  })

  it('stacks the wheel above the root and the mascot above the wheel', async () => {
    const { readFile } = await import('node:fs/promises')
    const styles = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'styles.ts'),
      'utf8',
    )
    const layer = (selector: string): number => {
      const rule = styles.slice(styles.indexOf(selector))
      return Number(/z-index:(\d+)/.exec(rule.slice(0, 220))?.[1] ?? '0')
    }

    // The mascot must stay clickable; the slices must not sit under it.
    expect(layer('.dshpet-wheel{')).toBeGreaterThan(0)
    expect(layer('.dshpet-mascot{')).toBeGreaterThan(layer('.dshpet-wheel{'))
  })

  it('measures the hover disc from the mascot, not the fixed root box', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The root is a fixed 72px, so at 56 or 88 its centre is 8px off.
    expect(overlay).toContain("querySelector('.dshpet-mascot')")
  })
})

describe('dispatch resumes an unloaded executor', () => {
  it('does not treat an evicted agent as a missing session', async () => {
    const { readFile } = await import('node:fs/promises')
    const entry = await readFile(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')
    const from = entry.indexOf('const dispatcher: PromptDispatcher')
    const block = entry.slice(from, entry.indexOf('\n  }\n', from))

    // `agents.get` only finds a LOADED agent. DSH unloads idle ones, so a Pet
    // Task that sat unused had its executor evicted and every later dispatch
    // failed with "is not live" — while the session was perfectly intact.
    expect(block).toContain('ctx.agents.resume(')
    expect(block).toContain('resumeSessionId')
  })

  it('still fails when the session itself is gone', async () => {
    const { readFile } = await import('node:fs/promises')
    const entry = await readFile(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')
    const from = entry.indexOf('const dispatcher: PromptDispatcher')
    const block = entry.slice(from, entry.indexOf('\n  }\n', from))

    // `sessions.get` also means LOADED, so gating on it re-created the very
    // bug being fixed. Resume itself reads persisted state, so its failure —
    // and only its failure — distinguishes evicted from deleted.
    expect(block).not.toContain('ctx.sessions.get(executorSessionId')
    expect(block).toContain('could not be resumed')
  })
})

describe('liveness checks never stand in for existence', () => {
  it('does not gate restart reconciliation on a loaded session', async () => {
    const { readFile } = await import('node:fs/promises')
    const entry = await readFile(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')
    const from = entry.indexOf('reconcileCreatingExecutors(')
    const block = entry.slice(from, from + 700)

    // Nothing is loaded at startup, so `agents.get`/`sessions.get` report
    // every session as gone and condemn healthy Tasks. The workspace's
    // session account is the durable record.
    expect(block).not.toContain('ctx.agents.get(')
    expect(block).not.toContain('ctx.sessions.get(')
    expect(block).toContain('sessionIds')
  })
})
