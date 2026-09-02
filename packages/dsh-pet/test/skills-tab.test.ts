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

describe('the directory browser tolerates an incomplete listing', () => {
  it('renders when the listing omits its arrays', async () => {
    stubApi({ revisions: [], selections: [], projection: [] })
    // A type assertion only CLAIMS these fields exist; a response missing one
    // would throw on the first `.length` or `.map` read and blank the tab.
    setDirectoryLister(async () => ({ path: '/Users/me' }) as never)
    const host = await mountSkills()

    await act(async () => {
      button(host, '\u6d4f\u89c8\u2026')?.click()
    })

    expect(button(host, '\u9009\u62e9\u5f53\u524d\u76ee\u5f55')).toBeDefined()
  })
})

describe('the mascot menu follows the Skill set', () => {
  it('reloads capabilities when Settings signals a change', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url))
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              ok: true,
              data: { capabilities: [], tasks: [], lifecycle: { phase: 'ready' } },
            }),
        }
      }),
    )
    const host = document.createElement('div')
    host.setAttribute('data-shell-overlay', '')
    document.body.appendChild(host)
    const { PetOverlay } = await import('../src/client/overlay.js')
    const { PET_SKILLS_EVENT } = await import('../src/client/accent.js')
    await act(async () => {
      createRoot(host).render(createElement(PetOverlay as never, { openSession: () => {} } as never))
    })
    const before = calls.filter(url => url.includes('capabilities')).length

    // Settings and the mascot are separate mount points, so without the
    // broadcast the menu kept whatever it fetched at mount and a new Skill
    // only appeared after a page reload.
    await act(async () => {
      globalThis.dispatchEvent(new Event(PET_SKILLS_EVENT))
    })

    expect(calls.filter(url => url.includes('capabilities')).length).toBeGreaterThan(before)
  })
})

describe('the Task panel survives an incomplete response', () => {
  it('renders when the payload omits its task list', async () => {
    stubApi({})
    const host = document.createElement('div')
    host.setAttribute('data-shell-overlay', '')
    document.body.appendChild(host)
    const { PetOverlay } = await import('../src/client/overlay.js')
    await act(async () => {
      createRoot(host).render(createElement(PetOverlay as never, { openSession: () => {} } as never))
    })

    // Open the panel: TaskPanel only mounts then, and that is where the
    // unnormalized list is read.
    await act(async () => {
      ;(host.querySelector('.dshpet-mascot') as HTMLElement)?.click()
    })

    // The overlay is a `list` slot, so a render throw makes the boundary
    // ABDICATE the entry: the mascot silently disappears until a reload,
    // which is harder to notice than a blank panel.
    expect(host.querySelector('.dshpet-panel')).not.toBeNull()
  })

  it('renders a task whose invocations are missing', async () => {
    stubApi({ tasks: [{ id: 't1', status: 'idle', epoch: 1 }] })
    const host = document.createElement('div')
    host.setAttribute('data-shell-overlay', '')
    document.body.appendChild(host)
    const { PetOverlay } = await import('../src/client/overlay.js')
    await act(async () => {
      createRoot(host).render(createElement(PetOverlay as never, { openSession: () => {} } as never))
    })
    await act(async () => {
      ;(host.querySelector('.dshpet-mascot') as HTMLElement)?.click()
    })

    expect(host.querySelector('.dshpet-panel')).not.toBeNull()
  })
})

describe('a stored setting keeps the editor open when the save fails', () => {
  it('stays in edit mode and surfaces the error instead of discarding it', async () => {
    // Reject every write, as a Host-side validation failure would.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 400,
        text: async () =>
          JSON.stringify({ ok: false, error: 'INVALID_REQUEST', message: '不接受该取值' }),
      })),
    )
    const host = document.createElement('div')
    document.body.appendChild(host)
    const { PetSettingsSection } = await import('../src/client/settings.js')
    await act(async () => {
      createRoot(host).render(
        createElement(PetSettingsSection, { initialTab: 'general' as const }),
      )
    })

    const editButtons = [...host.querySelectorAll('button')].filter(
      item => item.textContent === '编辑',
    ) as HTMLButtonElement[]
    await act(async () => {
      editButtons[editButtons.length - 1]?.click()
    })
    expect(button(host, '保存')).toBeDefined()

    await act(async () => {
      button(host, '保存')?.click()
    })

    // Returning to read-only on failure would silently discard the edit with
    // no way to correct the rejected value. Source-text assertions could not
    // detect this: the strings they matched stayed exactly where they were.
    expect(button(host, '保存')).toBeDefined()
    expect(button(host, '取消')).toBeDefined()
    expect(host.textContent).toContain('不接受该取值')
  })
})
