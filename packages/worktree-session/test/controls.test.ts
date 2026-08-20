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

import { openWorktreeInEditor, WorktreeControls } from '../src/client/controls.js'

function sessionLike() { return { blank: false } }
function useSessionsLike(selector: (state: { byId: Record<string, { cwd: string }> }) => { cwd: string } | undefined) {
  return selector({ byId: { 'session-a': { cwd: '/repo' } } })
}
function renderControls(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(WorktreeControls, {
    pluginContext: {},
    session: sessionLike(),
    sessionId: 'session-a',
    useSessions: useSessionsLike,
    ...overrides,
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
