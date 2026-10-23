/**
 * Mascot animation policy and failure fallback, with an injected fake player.
 *
 * No real Lottie runtime is involved: the failure modes that matter (error
 * events, blank DOM after DOMLoaded, reduced-motion/hidden changes) are
 * timing/event contracts, and a fake is the only way to assert them
 * deterministically. jsdom is used only for DOM nodes.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  createLatestOnly,
  createMascotAnimation,
  PlaybackGate,
  resolveMascotFace,
  resolvePlayback,
  type MascotEnvironment,
  type MascotPlayerHandle,
  type MascotPlayerLoader,
} from '../src/client/mascot-expression.js'
import {
  getMascotExpressionDiagnostic,
  setMascotExpressionDiagnostic,
  subscribeMascotExpressionDiagnostic,
} from '../src/client/mascot-diagnostics.js'
import type { PetExpressionView } from '../src/wire.js'

/** Valid minimal Lottie source (shape layer). */
const VALID = JSON.stringify({ v: '5.7.0', w: 100, h: 100, layers: [{ ty: 4, shapes: [] }] })

/** One view fixture. */
function okView(): PetExpressionView {
  return { state: 'ok', content: VALID, bytes: Buffer.byteLength(VALID), importedAt: 1 }
}

/** A controllable environment; `schedule` runs the check synchronously. */
function environment(overrides: Partial<MascotEnvironment> = {}): MascotEnvironment & {
  listeners: Array<() => void>
} {
  const listeners: Array<() => void> = []
  return {
    listeners,
    reducedMotion: () => false,
    hidden: () => false,
    subscribe: listener => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    schedule: callback => callback(),
    isDrawable: () => true,
    ...overrides,
  }
}

/** Recorded fake animation. */
function handle(events: { error?: () => void; domLoaded?: () => void } = {}): MascotPlayerHandle & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    stopFirstFrame: () => calls.push('first-frame'),
    destroy: () => calls.push('destroy'),
    on: (event, listener) => {
      if (event === 'error' && events.error !== undefined) events.error = listener
      if (event === 'DOMLoaded' && events.domLoaded !== undefined) events.domLoaded = listener
    },
  }
}

afterEach(() => {
  setMascotExpressionDiagnostic(undefined)
})

describe('which face to render', () => {
  it('prefers a valid animation over the glyph', () => {
    expect(resolveMascotFace(okView(), false)).toBe('animation')
    expect(resolveMascotFace(undefined, false)).toBe('glyph')
    expect(resolveMascotFace({ state: 'none' }, false)).toBe('glyph')
    expect(resolveMascotFace({ state: 'corrupt', diagnostic: 'bad' }, false)).toBe('glyph')
    expect(resolveMascotFace(okView(), true)).toBe('glyph')
  })

  it('renders the glyph and exposes the diagnostic for a corrupt read', () => {
    const seen: Array<string | undefined> = []
    const stop = subscribeMascotExpressionDiagnostic(() =>
      seen.push(getMascotExpressionDiagnostic()),
    )
    setMascotExpressionDiagnostic('文件损坏')

    expect(resolveMascotFace({ state: 'corrupt', diagnostic: '文件损坏' }, false)).toBe('glyph')
    expect(getMascotExpressionDiagnostic()).toBe('文件损坏')
    expect(seen).toEqual(['文件损坏'])
    stop()

    setMascotExpressionDiagnostic(undefined)
    expect(getMascotExpressionDiagnostic()).toBeUndefined()
    // Clearing an already-cleared diagnostic must not spam listeners.
    const before = seen.length
    setMascotExpressionDiagnostic(undefined)
    expect(seen.length).toBe(before)
  })
})

describe('playback policy', () => {
  it('never plays under reduced motion or while hidden', () => {
    expect(resolvePlayback(false, false)).toBe('play')
    expect(resolvePlayback(true, false)).toBe('pause')
    expect(resolvePlayback(false, true)).toBe('pause')
    expect(resolvePlayback(true, true)).toBe('pause')

    const gate = new PlaybackGate()
    expect(gate.update(true, false)).toBe('pause')
    expect(gate.pauseMode()).toBe('first-frame')
    expect(gate.update(false, true)).toBe('pause')
    expect(gate.pauseMode()).toBe('pause')
    expect(gate.update(false, false)).toBe('play')
  })

  it('pauses or freezes on environment changes and never resumes while forbidden', () => {
    const env = environment()
    let reduced = true
    let hidden = false
    env.reducedMotion = () => reduced
    env.hidden = () => hidden
    const animation = handle({
      error: () => undefined,
      domLoaded: () => undefined,
    })
    let autoplay: boolean | undefined
    const loader: MascotPlayerLoader = (_container, _data, shouldPlay) => {
      autoplay = shouldPlay
      return animation
    }

    const container = document.createElement('div')
    createMascotAnimation(container, VALID, { loader, environment: env })

    // Reduced motion at mount: no autoplay, and every environment change while
    // reduced must not start playback.
    expect(autoplay).toBe(false)
    hidden = true
    env.listeners.forEach(listener => listener())
    expect(animation.calls).not.toContain('play')
    hidden = false
    env.listeners.forEach(listener => listener())
    expect(animation.calls).not.toContain('play')
    expect(animation.calls).toContain('first-frame')

    reduced = false
    env.listeners.forEach(listener => listener())
    expect(animation.calls).toContain('play')

    hidden = true
    env.listeners.forEach(listener => listener())
    expect(animation.calls.filter(call => call === 'pause').length).toBeGreaterThan(0)
  })
})

describe('failure fallback', () => {
  it('falls back and publishes a diagnostic when the player fails', () => {
    const diagnostics: string[] = []
    const env = environment()
    const container = document.createElement('div')

    // 1. Loader throws synchronously.
    createMascotAnimation(container, VALID, {
      loader: () => {
        throw new Error('boom')
      },
      environment: env,
      onFailure: reason => diagnostics.push(reason),
    })
    expect(diagnostics[0]).toContain('boom')

    // 2. Player reports an error event.
    diagnostics.length = 0
    let errorListener: (() => void) | undefined
    const errorAnimation = handle()
    errorAnimation.on('error', () => undefined)
    const originalOn = errorAnimation.on
    errorAnimation.on = (event, listener) => {
      if (event === 'error') errorListener = listener
      originalOn(event, listener)
    }
    createMascotAnimation(container, VALID, {
      loader: () => errorAnimation,
      environment: env,
      onFailure: reason => diagnostics.push(reason),
    })
    errorListener?.()
    expect(diagnostics[0]).toContain('播放器报告')

    // 3. DOMLoaded fires but the container holds no drawable node.
    diagnostics.length = 0
    let domListener: (() => void) | undefined
    const blankAnimation = handle()
    blankAnimation.on = (event, listener) => {
      if (event === 'DOMLoaded') domListener = listener
    }
    createMascotAnimation(container, VALID, {
      loader: () => blankAnimation,
      environment: environment({ isDrawable: () => false }),
      onFailure: reason => diagnostics.push(reason),
    })
    domListener?.()
    expect(diagnostics[0]).toContain('没有可绘制内容')
  })

  it('reports success once the DOMLoaded check finds drawable output', () => {
    const env = environment()
    const container = document.createElement('div')
    const animation = handle()
    let domListener: (() => void) | undefined
    animation.on = (event, listener) => {
      if (event === 'DOMLoaded') domListener = listener
    }
    let ready = false
    createMascotAnimation(container, VALID, {
      loader: () => animation,
      environment: env,
      onReady: () => {
        ready = true
      },
    })
    domListener?.()
    expect(ready).toBe(true)
  })

  it('destroys the player and unsubscribes when torn down', () => {
    const env = environment()
    const container = document.createElement('div')
    const animation = handle()
    const mounted = createMascotAnimation(container, VALID, {
      loader: () => animation,
      environment: env,
    })
    expect(env.listeners).toHaveLength(1)
    mounted.destroy()
    expect(env.listeners).toHaveLength(0)
    expect(animation.calls).toContain('destroy')
  })
})

describe('latest-wins reads', () => {
  it('ignores stale reads so a late response cannot resurrect an expression', () => {
    const reads = createLatestOnly()
    const first = reads.begin()
    const second = reads.begin()

    expect(reads.isCurrent(second)).toBe(true)
    expect(reads.isCurrent(first)).toBe(false)
  })
})
