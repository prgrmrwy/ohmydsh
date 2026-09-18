import { describe, expect, it, vi } from 'vitest'
import { createWorktreeOpenHandlerRegistry } from '../src/open-handler.ts'

describe('worktree open handler registry', () => {
  it('uses the local fallback when no replacement is registered', () => {
    const fallback = vi.fn()
    createWorktreeOpenHandlerRegistry(fallback).open('/worktree')
    expect(fallback).toHaveBeenCalledWith('/worktree')
  })

  it('uses the latest replacement and does not also run the fallback', () => {
    const fallback = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const registry = createWorktreeOpenHandlerRegistry(fallback)
    registry.register(first)
    registry.register(second)
    registry.open('/worktree')
    expect(second).toHaveBeenCalledWith('/worktree')
    expect(first).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('restores the prior handler and eventually the fallback on disposal', () => {
    const fallback = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const registry = createWorktreeOpenHandlerRegistry(fallback)
    const disposeFirst = registry.register(first)
    const disposeSecond = registry.register(second)

    disposeSecond()
    registry.open('/one')
    expect(first).toHaveBeenCalledWith('/one')

    disposeFirst()
    registry.open('/two')
    expect(fallback).toHaveBeenCalledWith('/two')
  })

  it('falls back synchronously when a replacement throws', () => {
    const fallback = vi.fn()
    const registry = createWorktreeOpenHandlerRegistry(fallback)
    registry.register(() => { throw new Error('adapter unavailable') })

    expect(() => { registry.open('/worktree') }).not.toThrow()
    expect(fallback).toHaveBeenCalledWith('/worktree')
  })
})
