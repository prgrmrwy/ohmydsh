/**
 * Skills tab interaction, mounted for real.
 *
 * These exercise the rendered component rather than its source text: a render
 * crash blanks the tab and silently stops every button, which source-level
 * assertions cannot detect.
 *
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetSettingsSection, setDirectoryLister } from '../src/client/settings.js'

afterEach(() => {
  vi.unstubAllGlobals()
  setDirectoryLister(undefined)
  document.body.innerHTML = ''
})

/** Reply to every Pet route with one payload. */
function stubApi(data: unknown): string[] {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url))
      return { status: 200, text: async () => JSON.stringify({ ok: true, data }) }
    }),
  )
  return calls
}

/** Mount the Skills tab and return its container. */
async function mountSkills(): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(createElement(PetSettingsSection, { initialTab: 'skills' as const }))
  })
  return host
}

/** Find a button by its exact label. */
function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(item => item.textContent === label)
}

describe('the Skills tab survives an incomplete response', () => {
  it('renders when the payload omits its lists', async () => {
    // Replacing state wholesale with the raw response made a missing field
    // `undefined`; the first `.length` read then threw during render, blanking
    // the tab so every button stopped responding with no visible error.
    stubApi({})

    const host = await mountSkills()

    expect(button(host, '检查')).toBeDefined()
  })

  it('still reaches the Host when Inspect is clicked', async () => {
    const calls = stubApi({})
    const host = await mountSkills()

    await act(async () => {
      button(host, '检查')?.click()
    })

    expect(calls.some(url => url.includes('skill-inspect'))).toBe(true)
  })
})

describe('choosing a directory fills the field', () => {
  it('adopts the browsed path and closes the browser', async () => {
    stubApi({ revisions: [], selections: [], projection: [] })
    setDirectoryLister(async (target?: string) => ({
      path: target ?? '/Users/me',
      entries: [{ name: 'scripts', path: '/Users/me/scripts' }],
      crumbs: [{ name: '/', path: '/' }],
    }))
    const host = await mountSkills()

    await act(async () => {
      button(host, '浏览…')?.click()
    })
    expect(button(host, '选择当前目录')).toBeDefined()

    await act(async () => {
      button(host, '选择当前目录')?.click()
    })

    expect((host.querySelector('input') as HTMLInputElement).value).toBe('/Users/me')
    expect(button(host, '选择当前目录')).toBeUndefined()
  })
})
