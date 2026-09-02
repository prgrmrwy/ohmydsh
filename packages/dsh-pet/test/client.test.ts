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
    expect(PET_CSS).toContain('.dshpet-item:focus-visible')
  })

  it('adapts to narrow viewports', () => {
    expect(PET_CSS).toContain('@media (max-width:520px)')
  })

  it('disables touch scrolling interference while dragging', () => {
    expect(PET_CSS).toContain('touch-action:none')
  })
})

describe('settings information architecture', () => {
  it('exposes exactly the four stable tabs', () => {
    expect(PET_SETTINGS_TABS).toEqual(['general', 'skills', 'bindings', 'diagnostics'])
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

  it('explains that bindings prevent model-supplied destinations', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'bindings' as const }),
    )

    expect(markup).toContain('模型无法自行指定')
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
    // nothing, so Pet points at the real location instead.
    expect(entry).not.toContain('openSettings')
    expect(overlay).not.toContain('openSettings')
    expect(overlay).toContain('Manage in Settings')
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
    expect(overlay).toContain('shortcuts.map(')
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

  it('gates a capability that declares it requires confirmation', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // `clean-worktree` declares requiresConfirmation because its effects are
    // destructive; without a gate the flag was inert.
    expect(overlay).toContain('capability.requiresConfirmation')
    expect(overlay).toContain('setPendingConfirm(capability)')
    // The pending state must be a dependency or the second click never sees it.
    expect(overlay).toContain('[effectiveSource, pendingConfirm]')
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

describe('task panel navigates to both source and executor', () => {
  it('offers an Open source control for session-sourced Tasks', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Spec 9.5 requires navigation to the source AND the executor; only the
    // executor had a control, and TaskView did not even carry sourceId.
    expect(overlay).toContain('Open source')
    expect(overlay).toContain('props.openSession?.(task.sourceId!)')
    expect(overlay).toContain('sourceId?: string')
    // An archived source is disabled with a reason, never silently broken.
    expect(overlay).toContain("task.sourceAvailability === 'archived'")
    expect(overlay).toContain('source archived')
  })

  it('does not offer source navigation for an independent Task', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Guarded on a real session source, so a `none` Task shows no control.
    expect(overlay).toContain("task.sourceKind === 'session' && task.sourceId !== undefined")
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
    expect(PET_CSS).toContain(`.dshpet-mascot{width:${declared}px;height:${declared}px`)
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
    expect(overlay).toContain("if (mode === 'menu') setMode('closed')")
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

  it('does not treat the end of a drag as a click', async () => {
    const { readFile } = await import('node:fs/promises')
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Releasing the mascot at a new position would otherwise toggle the panel
    // open on every move.
    expect(overlay).toContain('draggedRef.current = state.moved')
    expect(overlay).toContain('if (draggedRef.current) {')
  })

  it('bridges the gap between the mascot and the menu while open', () => {
    // The menu renders above the 72px mascot box, so without a continuous
    // hover region the pointer crosses dead space and the menu collapses
    // before it can be used.
    expect(PET_CSS).toContain('.dshpet-root[data-open="true"]::before')
    expect(PET_CSS).toContain('bottom:100%')
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
    const styled = [...settings.matchAll(/<input\s+className="dshpet-input"/g)].length
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

  it('resets the Pet position through a broadcast, not a bare storage delete', async () => {
    const { readFile } = await import('node:fs/promises')
    const position = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'position.ts'),
      'utf8',
    )
    const overlay = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The overlay reads the stored position once into React state, so
    // clearing the key alone did nothing until a reload — the button looked
    // broken because it was.
    expect(position).toContain('PET_POSITION_RESET_EVENT')
    expect(overlay).toContain('PET_POSITION_RESET_EVENT')
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

    // Preset, context policy and all three binding fields are stored values,
    // so each shows its current setting until the user opts into editing.
    const fields = [...settings.matchAll(/<StoredField/g)].length
    expect(fields).toBeGreaterThanOrEqual(5)
  })

  it('returns to read-only only after the write succeeds', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )
    const field = settings.slice(settings.indexOf('function StoredField'))

    // A rejected save must keep the editor open with the input preserved so
    // the invalid field can be corrected.
    expect(field).toContain('.then(() => {')
    expect(field).toContain('setEditing(false)')
    expect(field).toContain('.catch((cause: unknown) =>')
  })

  it('renders the panel in Chinese', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'general' as const }),
    )

    expect(markup).toContain('模型')
    expect(markup).toContain('Agent 预设')
    expect(markup).toContain('重置桌宠位置')
    // The tab strip is Chinese too.
    expect(markup).toContain('通用')
  })
})


describe('Bindings explains what to configure and where to find it', () => {
  it('tells the user what a binding controls and what happens without one', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'bindings' as const }),
    )

    // A field name alone is not actionable: the panel has to say what the
    // value does and what breaks when it is missing.
    expect(markup).toContain('模型无法自行指定')
    expect(markup).toContain('拒绝执行')
  })

  it('gives a concrete way to look up the CR chat id', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'bindings' as const }),
    )

    // `oc_...` ids cannot be guessed, so the panel names the exact command
    // that produces one rather than leaving the user to search.
    expect(markup).toContain('lark-cli im +chat-search')
    expect(markup).toContain('chat_id')
  })

  it('offers workspaces as a choice instead of asking for a UUID', async () => {
    const { readFile } = await import('node:fs/promises')
    const settings = await readFile(
      path.resolve(__dirname, '..', 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    expect(settings).toContain('workspaceOptions')
    // With no known workspaces an empty <select> would trap the user, so the
    // field degrades to free text.
    expect(settings).toContain('workspaceOptions.length > 0')
  })

  it('marks the optional field as safe to leave empty', () => {
    const markup = renderToStaticMarkup(
      createElement(PetSettingsSection, { initialTab: 'bindings' as const }),
    )

    expect(markup).toContain('可以留空')
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
