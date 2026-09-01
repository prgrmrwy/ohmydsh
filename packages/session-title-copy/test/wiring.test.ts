import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HINT_LIFETIME_MS,
  HINT_MARKER,
  HINT_TEXT,
  reconcile,
  showCopiedHint,
  wireTitle,
  WIRED_MARKER,
  type CopyContext,
  type CopyHooks,
  type WiredButtonLike,
} from '../src/client/wiring.js'

interface RecordedListener {
  fn: (event: { stopPropagation(): void }) => void
  capture: boolean
}

/** Fake title button with a listener registry + attribute store. */
function fakeButton(attrs: Record<string, string> = {}): {
  button: WiredButtonLike
  listeners: RecordedListener[]
  disabled: (value: boolean) => void
  click: () => { stopped: boolean }
} {
  const attributes = new Map(Object.entries(attrs))
  const listeners: RecordedListener[] = []
  let stopped = false
  const button = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    addEventListener: (type: string, fn: (event: { stopPropagation(): void }) => void, options?: { capture?: boolean }) => {
      if (type === 'click') listeners.push({ fn, capture: options?.capture ?? false })
    },
    style: {} as { cursor?: string },
  }
  return {
    button,
    listeners,
    disabled: (value: boolean) => {
      if (value) attributes.set('disabled', '')
      else attributes.delete('disabled')
    },
    click: () => {
      stopped = false
      for (const l of listeners) {
        if (!l.capture) continue
        l.fn({ stopPropagation: () => { stopped = true } })
      }
      return { stopped }
    },
  }
}

function copyEnv(current: string | undefined): {
  ctx: CopyContext
  hooks: CopyHooks
  copied: string[]
  hints: number
} {
  const copied: string[] = []
  let hints = 0
  return {
    copied,
    get hints() {
      return hints
    },
    get ctx() {
      return { currentSessionId: () => current }
    },
    get hooks() {
      return {
        writeClipboard: async (text: string) => { copied.push(text) },
        showHint: () => { hints += 1 },
      }
    },
  }
}

describe('wireTitle', () => {
  it('is idempotent: marker, tooltip and a single capture listener', () => {
    const { button, listeners } = fakeButton()
    const env = copyEnv('s-1')
    wireTitle(button, env.ctx, env.hooks)
    wireTitle(button, env.ctx, env.hooks)
    expect(button.getAttribute(WIRED_MARKER)).toBe('')
    expect(button.getAttribute('title')).toBe('点击复制会话 ID')
    expect(listeners.length).toBe(1)
    expect(listeners[0]!.capture).toBe(true)
  })

  it('click copies the current session id and stops propagation', async () => {
    const { button, click } = fakeButton()
    const env = copyEnv('s-abc')
    wireTitle(button, env.ctx, env.hooks)
    const { stopped } = click()
    expect(stopped).toBe(true)
    await vi.waitFor(() => expect(env.copied).toEqual(['s-abc']))
    expect(env.hints).toBe(1)
  })

  it('click with no current session id does nothing', async () => {
    const { button, click } = fakeButton()
    const env = copyEnv(undefined)
    wireTitle(button, env.ctx, env.hooks)
    click()
    await Promise.resolve()
    expect(env.copied).toEqual([])
    expect(env.hints).toBe(0)
  })

  it('clipboard rejection is swallowed (no throw, no hint)', async () => {
    const { button, click } = fakeButton()
    const copied: string[] = []
    let hints = 0
    const ctx = { currentSessionId: () => 's-x' }
    const hooks: CopyHooks = {
      writeClipboard: async () => { throw new Error('denied') },
      showHint: () => { hints += 1 },
    }
    wireTitle(button, ctx, hooks)
    expect(() => click()).not.toThrow()
    await Promise.resolve()
    expect(copied).toEqual([])
    expect(hints).toBe(0)
  })
})

describe('reconcile', () => {
  it('removes disabled and sets the pointer cursor', () => {
    const { button } = fakeButton({ disabled: '' })
    const env = copyEnv('s-1')
    reconcile(button, env.ctx, env.hooks)
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.style?.cursor).toBe('pointer')
    expect(button.getAttribute(WIRED_MARKER)).toBe('')
  })

  it('re-arms when the official disabled attribute comes back (React re-render)', () => {
    const { button, disabled } = fakeButton({ disabled: '' })
    const env = copyEnv('s-1')
    reconcile(button, env.ctx, env.hooks)
    expect(button.hasAttribute('disabled')).toBe(false)
    disabled(true)
    reconcile(button, env.ctx, env.hooks)
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute(WIRED_MARKER)).toBe('')
  })

  it('is a no-op when the structure is unknown', () => {
    const env = copyEnv('s-1')
    expect(() => reconcile(null, env.ctx, env.hooks)).not.toThrow()
  })
})

describe('showCopiedHint', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  interface FakeHintEl {
    style: Record<string, string>
    setAttribute(name: string, value: string): void
    textContent: string | null
    remove(): void
    removed: boolean
  }

  function fakeDoc(): {
    doc: {
      body: { appendChild(node: FakeHintEl): void }
      createElement(tag: string): FakeHintEl
    }
    appended: FakeHintEl[]
    created: FakeHintEl[]
  } {
    const appended: FakeHintEl[] = []
    const created: FakeHintEl[] = []
    const doc = {
      body: { appendChild: (node: FakeHintEl) => { appended.push(node) } },
      createElement: () => {
        const el: FakeHintEl = {
          style: {},
          setAttribute: (n: string, v: string) => { (el as unknown as Record<string, unknown>)[n] = v },
          textContent: null,
          remove: () => { el.removed = true },
          removed: false,
        }
        created.push(el)
        return el
      },
    }
    return { doc, appended, created }
  }

  it('positions below the anchor and auto-removes after its lifetime', () => {
    const { doc, appended, created } = fakeDoc()
    const anchor = { getBoundingClientRect: () => ({ left: 120, bottom: 300 }) } as WiredButtonLike
    showCopiedHint(anchor, doc)
    expect(appended.length).toBe(1)
    const el = created[0]!
    expect((el as unknown as Record<string, unknown>)[HINT_MARKER]).toBe('')
    expect(el.style.left).toBe('120px')
    expect(el.style.top).toBe('306px')
    expect(el.textContent).toBe(HINT_TEXT)
    expect(el.removed).toBe(false)
    vi.advanceTimersByTime(HINT_LIFETIME_MS)
    expect(el.style.opacity).toBe('0')
    vi.advanceTimersByTime(300)
    expect(el.removed).toBe(true)
  })

  it('cleanup removes an in-flight hint immediately', () => {
    const { doc, created } = fakeDoc()
    const anchor = { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) } as WiredButtonLike
    const cleanup = showCopiedHint(anchor, doc)
    const el = created[0]!
    cleanup()
    expect(el.removed).toBe(true)
  })
})
