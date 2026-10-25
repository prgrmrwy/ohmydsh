/**
 * Live mascot-animation behavior through a real React mount.
 *
 * The injected loader keeps the real Lottie runtime out of jsdom (its UMD
 * probes a canvas context at import time). What is asserted here is the path
 * that used to be invisible to source review: the mascot reads the projection,
 * mounts the animation, and reacts to the Settings broadcast without a reload.
 *
 * @vitest-environment jsdom
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PET_APPEARANCE_EVENT } from '../src/client/accent.js'
import { PetOverlay } from '../src/client/overlay.js'
import {
  getMascotExpressionDiagnostic,
  setMascotExpressionDiagnostic,
} from '../src/client/mascot-diagnostics.js'
import type { MascotPlayerHandle, MascotPlayerLoader } from '../src/client/mascot-expression.js'
import * as entry from '../src/client/index.js'
import { lottieStubCalls, resetLottieStub } from './fixtures/lottie-stub.js'
import type { PetExpressionView } from '../src/wire.js'

/** Current projection the stubbed Host returns. */
let expression: PetExpressionView = { state: 'none' }
/** Playback mode the stubbed Host config reports. */
let playbackMode: 'loop' | 'hover' = 'loop'
/** Player calls recorded by the fake loader (play / first-frame / pause). */
const playbackCalls: string[] = []

/** Route-aware fetch stub: every Pet call the overlay makes is answered. */
function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const href = String(url)
      let data: unknown = {}
      if (href.includes('/api/expression')) data = expression
      else if (href.includes('/api/config')) {
        data = { defaultContextPolicy: 'none', appearance: { animationPlayback: playbackMode } }
      }
      else if (href.includes('/api/capabilities')) data = { capabilities: [] }
      else if (href.includes('/api/channel')) data = { connection: { phase: 'stopped', queueDepth: 0 } }
      else if (href.includes('/api/status')) {
        data = {
          lifecycle: { phase: 'ready', generation: 1 },
          version: '0.2.0',
          skillSetGeneration: 1,
          generation: 1,
          stale: false,
        }
      }
      return { status: 200, text: async () => JSON.stringify({ ok: true, data }) }
    }),
  )
}

/**
 * Loader that produces a drawable SVG and reports DOMLoaded, so the mascot's
 * bounded post-load check sees a real painted node.
 */
const drawableLoader: MascotPlayerLoader = container => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
  container.appendChild(svg)
  const handle: MascotPlayerHandle = {
    play: () => playbackCalls.push('play'),
    pause: () => playbackCalls.push('pause'),
    stopFirstFrame: () => playbackCalls.push('first-frame'),
    destroy: () => svg.remove(),
    on: (event, listener) => {
      if (event === 'DOMLoaded') setTimeout(listener, 0)
    },
  }
  return handle
}

/** Valid minimal Lottie source. */
const VALID = JSON.stringify({ v: '5.7.0', w: 100, h: 100, layers: [{ ty: 4, shapes: [] }] })

/** Wait for effects, fetches and the two-frame drawable check. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 120))

let mounted: { root: Root; host: HTMLElement } | undefined

beforeEach(() => {
  expression = { state: 'none' }
  playbackMode = 'loop'
  playbackCalls.length = 0
  setMascotExpressionDiagnostic(undefined)
  resetLottieStub()
  stubFetch()
})

afterEach(async () => {
  const current = mounted
  mounted = undefined
  if (current !== undefined) {
    current.root.unmount()
    await new Promise(resolve => setTimeout(resolve, 0))
    current.host.remove()
  }
  vi.unstubAllGlobals()
})

/**
 * Mount the overlay with the fake player.
 * @returns the host element and Pet's root node.
 */
async function mount(): Promise<{ host: HTMLElement; root: HTMLElement }> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted = { root, host }
  root.render(
    createElement(PetOverlay, {
      currentSource: undefined,
      loadAnimation: drawableLoader,
    } as never),
  )
  await settle()
  const node = host.querySelector('.dshpet-root')
  if (node === null) throw new Error('Pet did not mount')
  return { host, root: node as HTMLElement }
}

describe('mascot animation mounts and refreshes', () => {
  it('refreshes the mascot on appearance broadcast without reload', async () => {
    expression = { state: 'ok', content: VALID, bytes: 64, importedAt: Date.now() }
    const { host } = await mount()
    expect(host.querySelector('.dshpet-lottie')).not.toBeNull()

    // Simulate the Settings root removing the animation and broadcasting.
    expression = { state: 'none' }
    globalThis.dispatchEvent(new Event(PET_APPEARANCE_EVENT))
    await settle()

    expect(host.querySelector('.dshpet-lottie')).toBeNull()
    expect(host.textContent).toContain('🐾')
  })

  it('treats the open wheel disc as hovering the mascot', async () => {
    playbackMode = 'hover'
    expression = { state: 'ok', content: VALID, bytes: 64, importedAt: Date.now() }
    const { host } = await mount()

    // Hover mode starts frozen on the first frame.
    expect(playbackCalls).toContain('first-frame')
    expect(playbackCalls).not.toContain('play')

    // Open the capability wheel, then move the pointer onto the ring area.
    const mascot = host.querySelector('.dshpet-mascot')
    if (mascot === null) throw new Error('mascot did not render')
    mascot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await settle()
    expect(host.querySelector('.dshpet-wheel')).not.toBeNull()

    // jsdom reports a zero-size mascot box, so any positive distance is
    // outside the button but inside the wheel radius (36 + 20 + 38).
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 0, bubbles: true }))
    await settle()
    expect(playbackCalls).toContain('play')

    // Leaving the disc stops and rewinds to the first frame.
    const before = playbackCalls.filter(call => call === 'first-frame').length
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 600, clientY: 600, bubbles: true }))
    await settle()
    expect(playbackCalls.filter(call => call === 'first-frame').length).toBeGreaterThan(before)
  })

  it('renders the glyph and publishes the diagnostic for a corrupt read', async () => {
    expression = { state: 'corrupt', diagnostic: '文件已损坏' }
    const { host } = await mount()

    expect(host.querySelector('.dshpet-lottie')).toBeNull()
    expect(getMascotExpressionDiagnostic()).toBe('文件已损坏')
  })

  it('imports the client entry under jsdom without evaluating the real player', () => {
    // The real lottie UMD throws at module evaluation in jsdom (canvas probe);
    // the static import above proves the entry is safe, and the stub proves
    // nothing tried to load an animation just by importing the entry.
    expect(typeof entry.apply).toBe('function')
    expect(lottieStubCalls()).toEqual([])
  })
})
