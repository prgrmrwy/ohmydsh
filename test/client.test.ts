import { describe, expect, it, vi } from 'vitest'
import {
  COCKPIT_EDITOR_OPEN_SERVICE,
  WORKTREE_OPEN_HANDLER_SERVICE,
  apply,
} from '../src/client/index.ts'

type Listener = (name: string, value: unknown) => void

function fixture() {
  const services = new Map<string, unknown>()
  const listeners = new Set<Listener>()
  let cleanup: (() => void) | undefined
  const reads: string[] = []
  const ctx = {
    get(name: string) {
      reads.push(name)
      return services.get(name)
    },
    on(name: string, listener: Listener) {
      expect(name).toBe('internal/service')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    effect(callback: () => () => void) {
      cleanup = callback()
    },
  }
  const provide = (name: string, value: unknown) => {
    if (value === undefined) services.delete(name)
    else services.set(name, value)
    for (const listener of listeners) listener(name, value)
  }
  return { ctx, provide, reads, cleanup: () => cleanup?.() }
}

function registryFixture() {
  let handler: ((path: string) => void) | undefined
  const unregister = vi.fn(() => { handler = undefined })
  return {
    registry: {
      register: vi.fn((next: (path: string) => void) => {
        handler = next
        return unregister
      }),
    },
    invoke(path: string) { handler?.(path) },
    unregister,
  }
}

describe('cockpit worktree open shim', () => {
  it('registers only after both endpoint services exist, in either load order', () => {
    for (const order of ['registry-first', 'editor-first'] as const) {
      const f = fixture()
      const r = registryFixture()
      const editor = { open: vi.fn() }
      apply(f.ctx as never)

      if (order === 'registry-first') {
        f.provide(WORKTREE_OPEN_HANDLER_SERVICE, r.registry)
        expect(r.registry.register).not.toHaveBeenCalled()
        f.provide(COCKPIT_EDITOR_OPEN_SERVICE, editor)
      } else {
        f.provide(COCKPIT_EDITOR_OPEN_SERVICE, editor)
        expect(r.registry.register).not.toHaveBeenCalled()
        f.provide(WORKTREE_OPEN_HANDLER_SERVICE, r.registry)
      }

      expect(r.registry.register).toHaveBeenCalledTimes(1)
      r.invoke('/vm/worktree')
      expect(editor.open).toHaveBeenCalledWith('/vm/worktree')
      f.cleanup()
    }
  })

  it('detaches on either service unload and reconnects when it returns', () => {
    const f = fixture()
    const r = registryFixture()
    const first = { open: vi.fn() }
    const second = { open: vi.fn() }
    f.provide(WORKTREE_OPEN_HANDLER_SERVICE, r.registry)
    f.provide(COCKPIT_EDITOR_OPEN_SERVICE, first)
    apply(f.ctx as never)
    expect(r.registry.register).toHaveBeenCalledTimes(1)

    f.provide(COCKPIT_EDITOR_OPEN_SERVICE, undefined)
    expect(r.unregister).toHaveBeenCalledTimes(1)
    f.provide(COCKPIT_EDITOR_OPEN_SERVICE, second)
    expect(r.registry.register).toHaveBeenCalledTimes(2)
    r.invoke('/vm/next')
    expect(second.open).toHaveBeenCalledWith('/vm/next')
  })

  it('reads exact dotted service names and forwards paths unchanged', () => {
    const f = fixture()
    const r = registryFixture()
    const editor = { open: vi.fn() }
    f.provide(WORKTREE_OPEN_HANDLER_SERVICE, r.registry)
    f.provide(COCKPIT_EDITOR_OPEN_SERVICE, editor)
    apply(f.ctx as never)
    r.invoke('/vm/a b/../literal')

    expect(editor.open).toHaveBeenCalledWith('/vm/a b/../literal')
    expect(f.reads).toContain('cockpitBridge.editorOpen')
    expect(f.reads).toContain('worktreeSession.openHandler')
    expect(f.reads).not.toContain('cockpitBridge')
    expect(f.reads).not.toContain('worktreeSession')
  })

  it('does nothing when either endpoint never exists', () => {
    const f = fixture()
    expect(() => apply(f.ctx as never)).not.toThrow()
    f.provide('unrelated.service', {})
    f.cleanup()
  })
})
