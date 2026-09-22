import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WORKTREE_OPEN_HANDLER_SERVICE, type WorktreeOpenHandlerRegistry } from '../src/open-handler.ts'

const { fallback } = vi.hoisted(() => ({ fallback: vi.fn() }))
vi.mock('../src/client/controls.tsx', async () => ({
  WorktreeControls: () => null,
  openWorktreeInEditor: fallback,
}))
vi.mock('../src/client/handoff.ts', () => ({ restoreAllSubmits: () => {} }))

import { apply, inject } from '../src/client/index.tsx'

describe('worktree-session client open-handler wiring', () => {
  it('keeps optional open adapters out of the load-time inject list', () => {
    expect(inject).toEqual(['slots', 'sessions', 'conversation'])
  })

  it('provides the registry and injects its live opener into the slot', () => {
    let registry: WorktreeOpenHandlerRegistry | undefined
    let renderSeat: ((props: Record<string, unknown>) => ReactElement) | undefined
    const ctx = {
      provide(name: string, value: unknown) {
        expect(name).toBe(WORKTREE_OPEN_HANDLER_SERVICE)
        registry = value as WorktreeOpenHandlerRegistry
        return () => { registry = undefined }
      },
      slots: {
        inject(_seat: string, callback: () => void) { callback() },
        register(_meta: unknown, render: (props: Record<string, unknown>) => ReactElement) {
          renderSeat = render
          return () => {}
        },
      },
      effect(callback: () => unknown) { callback() },
    }

    apply(ctx as never)
    expect(registry).toBeDefined()
    const element = renderSeat!({ sessionId: 'session-a' })
    const replacement = vi.fn()
    const unregister = registry!.register(replacement)

    ;(element.props as { openWorktree(path: string): void }).openWorktree('/vm/worktree')
    expect(replacement).toHaveBeenCalledWith('/vm/worktree')
    expect(fallback).not.toHaveBeenCalled()

    unregister()
    ;(element.props as { openWorktree(path: string): void }).openWorktree('/local/worktree')
    expect(fallback).toHaveBeenCalledWith('/local/worktree')
  })
})
