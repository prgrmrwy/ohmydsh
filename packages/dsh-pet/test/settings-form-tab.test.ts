/**
 * Which Appearance form opens by default.
 *
 * The settings panel can be mounted before an animation is imported and kept
 * mounted afterwards, so a one-shot expression read at mount raced the real
 * state and always left the Emoji form selected. Presence is now shared from
 * the overlay through `expression-presence`, and Settings follows it.
 *
 * @vitest-environment jsdom
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PetSettingsSection } from '../src/client/settings.js'
import { setExpressionPresence } from '../src/client/expression-presence.js'

/** Expression projection the stubbed Host answers with. */
let expression: 'ok' | 'none' | 'fail' = 'none'

/** Pending timers/fetches settle. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 120))

let mounted: { root: Root; host: HTMLElement } | undefined

beforeEach(() => {
  expression = 'none'
  setExpressionPresence('unknown')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const href = String(url)
      if (href.includes('/api/expression')) {
        if (expression === 'fail') throw new Error('host not ready')
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              ok: true,
              data:
                expression === 'ok'
                  ? { state: 'ok', content: '{"v":"5.0.0"}', bytes: 10, importedAt: Date.now() }
                  : { state: 'none' },
            }),
        }
      }
      return { status: 200, text: async () => JSON.stringify({ ok: true, data: {} }) }
    }),
  )
})

afterEach(() => {
  const current = mounted
  mounted = undefined
  if (current !== undefined) {
    current.root.unmount()
    current.host.remove()
  }
  vi.unstubAllGlobals()
  setExpressionPresence('unknown')
})

/**
 * Mount the settings section on the General tab.
 * @returns the host element.
 */
async function mount(): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted = { root, host }
  root.render(createElement(PetSettingsSection, { initialTab: 'general' as const }))
  await settle()
  return host
}

/**
 * Read the selected Appearance form.
 * @param host - Mounted settings.
 * @returns the selected tab id.
 */
function selectedForm(host: HTMLElement): string | null {
  const selected = host.querySelector('[id^="dshpet-form-tab-"][aria-selected="true"]')
  return selected?.getAttribute('id') ?? null
}

describe('appearance form default', () => {
  it('opens the animation form when an animation is already active', async () => {
    expression = 'ok'
    const host = await mount()
    expect(selectedForm(host)).toBe('dshpet-form-tab-lottie')
  })

  it('follows a later presence change when Settings mounted first', async () => {
    // The settings root was mounted while the expression read failed (Host not
    // ready yet); the overlay's later successful read must still flip the form.
    expression = 'fail'
    const host = await mount()
    expect(selectedForm(host)).toBe('dshpet-form-tab-emoji')

    setExpressionPresence('ok')
    await settle()
    expect(selectedForm(host)).toBe('dshpet-form-tab-lottie')

    setExpressionPresence('none')
    await settle()
    expect(selectedForm(host)).toBe('dshpet-form-tab-emoji')
  })

  it('keeps a manual switch', async () => {
    expression = 'ok'
    const host = await mount()
    expect(selectedForm(host)).toBe('dshpet-form-tab-lottie')

    const emoji = host.querySelector('#dshpet-form-tab-emoji') as HTMLButtonElement
    emoji.click()
    await settle()
    expect(selectedForm(host)).toBe('dshpet-form-tab-emoji')

    // A presence change after the manual choice must not override it.
    setExpressionPresence('none')
    setExpressionPresence('ok')
    await settle()
    expect(selectedForm(host)).toBe('dshpet-form-tab-emoji')
  })
})
