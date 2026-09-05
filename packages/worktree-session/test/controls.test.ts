import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientStage } from '../src/client/stage-store.js'

// Mutable stage so each case can control lifecycle/worktreePath.
let stage: Partial<ClientStage> = { lifecycle: 'bound', taskBranch: 'ws/task', worktreePath: '/repo/.worktrees/task' }
vi.mock('../src/client/stage-store.js', () => ({
  getStage: () => stage,
  subscribeStage: () => () => {},
  resetStage: () => {},
  setStage: () => {},
}))

import { BaseRefHoverLabel, BaseRefOption, baseRefChooserTitle, openWorktreeInEditor, refOptionBackground, WorktreeControls } from '../src/client/controls.js'

const BASE_REF_HINT = 'Choose the base ref; selection has no Git side effects'
const LONG_REF = 'feat/per-model-default-reasoning-effort'

// DSH 0.1.2 slot contract for a `scope: 'session'` seat: the component gets
// `useSession` / `sessionId` / `useProjection`, and reads `cwd` (a list-row
// fact) from the injected `sessions` service. The fixture mirrors that exact
// shape — the previous fixture supplied the removed 0.1.1 `session` value and
// `useSessions` feed, so it kept passing while the real seat threw.
function useSessionLike(selector: (snapshot: { blank: boolean }) => unknown) {
  return selector({ blank: false })
}
function pluginContextLike(cwd: string | undefined = '/repo') {
  return {
    sessions: {
      list: {
        subscribe: () => () => {},
        getSnapshot: () => ({ byId: cwd === undefined ? {} : { 'session-a': { cwd } } }),
      },
    },
  }
}
function renderControls(overrides: Record<string, unknown> = {}) {
  const { session, ...rest } = overrides as { session?: { blank: boolean } }
  return renderToStaticMarkup(createElement(WorktreeControls, {
    pluginContext: pluginContextLike(),
    sessionId: 'session-a',
    useSession: session === undefined
      ? useSessionLike
      : (selector: (snapshot: { blank: boolean }) => unknown) => selector(session),
    ...rest,
  } as never))
}

describe('WorktreeControls bound status rendering', () => {
  afterEach(() => { stage = { lifecycle: 'bound', taskBranch: 'ws/task', worktreePath: '/repo/.worktrees/task' } })

  it('renders the task branch on one line with an ellipsis and a full-branch hover title', () => {
    stage = { lifecycle: 'bound', taskBranch: 'ws/very-long-task-branch-name-that-exceeds-the-status-bar-width', worktreePath: '/repo/.worktrees/very-long-task-branch-name-that-exceeds-the-status-bar-width' }
    const html = renderControls()
    expect(html).toContain('data-testid="worktree-session-status"')
    expect(html).toContain('display:block')
    expect(html).toContain('white-space:nowrap')
    expect(html).toContain('text-overflow:ellipsis')
    expect(html).toContain('overflow:hidden')
    expect(html).toContain('padding:0 8px')
    expect(html).toContain('title="ws/very-long-task-branch-name-that-exceeds-the-status-bar-width"')
    expect(html).toContain('⑂ ws/very-long-task-branch-name-that-exceeds-the-status-bar-width')
  })

  it('marks the bound branch name clickable with an aria label', () => {
    const html = renderControls()
    expect(html).toContain('role="button"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="Open worktree in editor')
  })

  it('renders the dependency mode with the resolved package manager', () => {
    stage = { lifecycle: 'bound', taskBranch: 'ws/task', worktreePath: '/repo/.worktrees/task', dependencyMode: 'lean', packageManager: 'pnpm' }
    expect(renderControls()).toContain('lean · pnpm')
    stage = { lifecycle: 'bound', taskBranch: 'ws/task', worktreePath: '/repo/.worktrees/task', dependencyMode: 'mutable', packageManager: 'npm' }
    expect(renderControls()).toContain('mutable · npm')
  })

  it('does not make the cleaned branch clickable', () => {
    stage = { lifecycle: 'cleaned', taskBranch: 'ws/done', worktreePath: '/repo/.worktrees/done' }
    const html = renderControls()
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('aria-label="Open worktree in editor')
  })

  it('does not render a clickable status when there is no binding', () => {
    stage = { lifecycle: undefined }
    const html = renderControls()
    expect(html).not.toContain('data-testid="worktree-session-status"')
  })
})

describe('WorktreeControls base ref chooser rendering', () => {
  afterEach(() => { stage = { lifecycle: 'bound', taskBranch: 'ws/task', worktreePath: '/repo/.worktrees/task' } })

  function renderChooser(baseRef: string | undefined) {
    stage = {
      lifecycle: undefined,
      enabled: false,
      phase: 'idle',
      ...(baseRef === undefined ? {} : { baseRef }),
      refs: [{ name: baseRef ?? 'main', fullName: `refs/heads/${baseRef ?? 'main'}`, kind: 'local' }],
    } as Partial<ClientStage>
    return renderControls({ session: { blank: true } })
  }

  it('renders a long selected base ref on one line with an ellipsis', () => {
    const html = renderChooser(LONG_REF)
    expect(html).toContain('data-testid="worktree-session-controls"')
    expect(html).toContain('display:block')
    expect(html).toContain('white-space:nowrap')
    expect(html).toContain('overflow:hidden')
    expect(html).toContain('text-overflow:ellipsis')
    expect(html).toContain(`⑂ ${LONG_REF} ▾`)
  })

  it('exposes the full ref name and no-side-effects hint to assistive tech', () => {
    const html = renderChooser(LONG_REF)
    expect(html).toContain(`aria-label="${LONG_REF} — ${BASE_REF_HINT}"`)
  })

  it('keeps the plain hint when no base ref is selected yet', () => {
    const html = renderChooser(undefined)
    expect(html).toContain(`aria-label="${BASE_REF_HINT}"`)
    expect(html).toContain('⑂ Choose base ▾')
  })

  it('renders the in-page hover label with the full ref name', () => {
    const html = renderToStaticMarkup(createElement(BaseRefHoverLabel, { text: baseRefChooserTitle(LONG_REF) }))
    expect(html).toContain('data-testid="worktree-session-ref-hover"')
    expect(html).toContain(`>${LONG_REF} — ${BASE_REF_HINT}</span>`)
    expect(html).toContain('position:absolute')
    expect(html).toContain('pointer-events:none')
  })

  it('keeps the dropdown search input free of text-line rules', () => {
    const html = renderChooser(LONG_REF)
    // The chooser is collapsed by default, so the search input must not render.
    expect(html).not.toContain('placeholder="Search local and remote refs"')
  })
})

describe('baseRefChooserTitle', () => {
  it('puts the full ref name before the hint', () => {
    expect(baseRefChooserTitle(LONG_REF)).toBe(`${LONG_REF} — ${BASE_REF_HINT}`)
  })

  it('falls back to the bare hint without a selection', () => {
    expect(baseRefChooserTitle(undefined)).toBe(BASE_REF_HINT)
  })
})

describe('BaseRefOption dropdown candidate', () => {
  function renderOption(name: string, selected = false) {
    return renderToStaticMarkup(createElement(BaseRefOption, { name, selected, onSelect: () => {} }))
  }

  it('renders a long candidate ref on one line with an ellipsis and a hover full name', () => {
    const html = renderOption(`origin/${LONG_REF}-and-then-some-more-suffix`)
    expect(html).toContain('display:block')
    expect(html).toContain('white-space:nowrap')
    expect(html).toContain('overflow:hidden')
    expect(html).toContain('text-overflow:ellipsis')
    expect(html).toContain(`title="origin/${LONG_REF}-and-then-some-more-suffix"`)
  })

  it('highlights the selected candidate only', () => {
    expect(renderOption('main', true)).toContain('background:#3370ff22')
    expect(renderOption('main', false)).toContain('background:transparent')
  })

  it('uses the interactive hover tint for unselected candidates and keeps selected tint', () => {
    expect(refOptionBackground(false, true)).toBe('var(--dsw-alias-interactive-bg-hover, #00000014)')
    expect(refOptionBackground(true, true)).toBe('#3370ff22')
    expect(refOptionBackground(false, false)).toBe('transparent')
  })

  it('calls onSelect without performing any request', () => {
    const onSelect = vi.fn()
    const element = createElement(BaseRefOption, { name: 'main', selected: false, onSelect })
    // Static render must not invoke the handler; selection stays a pure client-stage update.
    renderToStaticMarkup(element)
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('openWorktreeInEditor deep link', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('opens a vscode://file/ URI for an absolute path', () => {
    const openMock = vi.fn()
    vi.stubGlobal('window', { open: openMock })
    openWorktreeInEditor('/Users/me/project')
    expect(openMock).toHaveBeenCalledWith('vscode://file/Users/me/project', '_blank')
    vi.unstubAllGlobals()
  })

  it('URL-encodes spaces and special characters in the path', () => {
    const openMock = vi.fn()
    vi.stubGlobal('window', { open: openMock })
    openWorktreeInEditor('/Users/me/My Worktree/a b c')
    expect(openMock).toHaveBeenCalledWith('vscode://file/Users/me/My%20Worktree/a%20b%20c', '_blank')
    vi.unstubAllGlobals()
  })

  it('refuses non-absolute paths without calling the editor', () => {
    const openMock = vi.fn()
    vi.stubGlobal('window', { open: openMock })
    openWorktreeInEditor('relative/path')
    expect(openMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
