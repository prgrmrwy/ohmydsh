// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerMemexSettingsNavIcon } from '../src/client/nav-icon.js'
import { NAV_MARKER } from '../src/client/styles.js'

function mountNav(): { ours: HTMLButtonElement; other: HTMLButtonElement } {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const nav = document.createElement('nav')
  const ours = document.createElement('button')
  ours.innerHTML = '<svg></svg><span>记忆</span>'
  const other = document.createElement('button')
  other.innerHTML = '<svg></svg><span>plugins</span>'
  nav.append(ours, other)
  dialog.appendChild(nav)
  document.body.appendChild(dialog)
  return { ours, other }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('settings nav glyph', () => {
  it('marks only its own row, and unmarks it on disposal', () => {
    const { ours, other } = mountNav()
    const dispose = registerMemexSettingsNavIcon(() => '记忆')
    expect(ours.hasAttribute(NAV_MARKER)).toBe(true)
    expect(other.hasAttribute(NAV_MARKER)).toBe(false)
    dispose()
    expect(ours.hasAttribute(NAV_MARKER)).toBe(false)
  })

  it('re-marks the row after the label changes with the locale', async () => {
    const { ours } = mountNav()
    const label = { current: '记忆' }
    const dispose = registerMemexSettingsNavIcon(() => label.current)

    label.current = 'Memory'
    ours.innerHTML = '<svg></svg><span>Memory</span>'
    await vi.waitFor(() => expect(ours.hasAttribute(NAV_MARKER)).toBe(true))
    dispose()
    expect(ours.hasAttribute(NAV_MARKER)).toBe(false)
  })

  it('stays silent when its row cannot be located', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    expect(() => registerMemexSettingsNavIcon(() => '记忆')()).not.toThrow()
  })
})
