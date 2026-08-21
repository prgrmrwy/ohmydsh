import { describe, expect, it, vi } from 'vitest'
import { bindSelectionDirectory, type SelectionDirectory } from '../src/client/selection-binding.js'

function directory(current: { provider: string; model: string } | null): {
  value: SelectionDirectory
  emit(next: { provider: string; model: string }): void
  stopped(): boolean
} {
  let snapshot = { current }
  let listener: (() => void) | undefined
  let didStop = false
  return {
    value: {
      store: {
        getSnapshot: () => snapshot,
        subscribe(fn) { listener = fn; return () => { didStop = true; listener = undefined } },
      },
      load: vi.fn(async () => undefined),
    },
    emit(next) { snapshot = { current: next }; listener?.() },
    stopped: () => didStop,
  }
}

describe('selection directory binding lifecycle', () => {
  it('publishes the current selector value and future changes', () => {
    const d = directory({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    const selected = new Map()
    const reconcile = vi.fn()
    const stop = bindSelectionDirectory('s1', () => d.value, selected, reconcile)
    expect(selected.get('s1')).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    d.emit({ provider: 'codex', model: 'gpt-5.6-sol' })
    expect(selected.get('s1')).toEqual({ provider: 'codex', model: 'gpt-5.6-sol' })
    expect(reconcile).toHaveBeenCalledTimes(2)
    stop()
    expect(d.stopped()).toBe(true)
  })

  it('allows the same session to retry after a transient resolver failure', () => {
    const d = directory({ provider: 'opencode-go', model: 'deepseek-v4-flash' })
    const selected = new Map()
    let attempts = 0
    const resolve = (): SelectionDirectory => {
      attempts += 1
      if (attempts === 1) throw new Error('session scope not ready yet')
      return d.value
    }
    expect(() => bindSelectionDirectory('s1', resolve, selected, () => undefined)).toThrow('not ready')
    expect(selected.has('s1')).toBe(false)
    expect(() => bindSelectionDirectory('s1', resolve, selected, () => undefined)).not.toThrow()
    expect(attempts).toBe(2)
    expect(selected.get('s1')).toEqual({ provider: 'opencode-go', model: 'deepseek-v4-flash' })
  })
})
