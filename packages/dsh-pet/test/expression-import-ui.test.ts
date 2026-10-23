/**
 * Animation import UI: replacement confirmation and progress.
 *
 * The bug this guards: with an animation already active, the button used a
 * native `window.confirm`. WebViews/PWAs can suppress that dialog, so the
 * click did nothing and looked like a dead button. The surface must instead
 * show an in-page confirmation and only then send the import request.
 *
 * @vitest-environment jsdom
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExpressionSection } from '../src/client/settings.js'
import type { PetExpressionView } from '../src/wire.js'

/** The projection the stubbed Host currently returns. */
let expression: PetExpressionView

/** Every URL the surface asked the Host about. */
const calls: string[] = []

/** One successful Pet envelope. */
function respond(data: unknown): { status: number; text: () => Promise<string> } {
  return { status: 200, text: async () => JSON.stringify({ ok: true, data }) }
}

const VIEW: PetExpressionView = {
  state: 'ok',
  content: JSON.stringify({ v: '5.0.0', w: 1, h: 1, layers: [{ ty: 4 }] }),
  bytes: 68,
  importedAt: Date.now(),
}

beforeEach(() => {
  calls.length = 0
  expression = VIEW
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const href = String(url)
      calls.push(href)
      if (href.includes('/expression-import-url')) {
        expression = { state: 'ok', content: '{"v":"5.0.0"}', bytes: 68_027, importedAt: Date.now() }
        return respond({ state: 'ok', bytes: 68_027 })
      }
      if (href.includes('/expression-import')) return respond({ state: 'ok', bytes: 1 })
      if (href.includes('/expression')) return respond(expression)
      return respond({})
    }),
  )
})

let mounted: { root: Root; host: HTMLElement } | undefined

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

/** Wait for effects and stubbed fetches. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 60))

/**
 * Mount the animation section.
 * @returns the host element.
 */
async function mount(): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted = { root, host }
  root.render(createElement(ExpressionSection))
  await settle()
  return host
}

/** Set a controlled input's value the way a paste does. */
function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Find a button by its visible label. */
function button(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(node => node.textContent?.trim() === label)
  if (found === undefined) throw new Error(`button ${label} not found`)
  return found as HTMLButtonElement
}

describe('URL import replacement flow', () => {
  it('confirms in-page before replacing, then imports and reports success', async () => {
    const host = await mount()

    const input = host.querySelector('input[type="url"]') as HTMLInputElement
    setInput(input, 'https://fonts.gstatic.cn/s/e/notoemoji/latest/1f914/lottie.json')
    await settle()

    button(host, '从 URL 导入').click()
    await settle()

    // Confirmation is visible and no import request has been sent yet.
    expect(host.textContent).toContain('确认替换')
    expect(host.textContent).toContain('当前动画将被替换且不保留')
    expect(calls.some(url => url.includes('expression-import-url'))).toBe(false)

    button(host, '确认替换').click()
    await settle()

    expect(calls.some(url => url.includes('expression-import-url'))).toBe(true)
    expect(host.textContent).toContain('已导入动画（68027 字节）')
    expect(host.textContent).not.toContain('确认替换')
  })

  it('imports immediately when no animation is active', async () => {
    expression = { state: 'none' }
    const host = await mount()

    const input = host.querySelector('input[type="url"]') as HTMLInputElement
    setInput(input, 'https://fonts.gstatic.cn/s/e/notoemoji/latest/1f914/lottie.json')
    await settle()

    button(host, '从 URL 导入').click()
    await settle()

    expect(host.textContent).not.toContain('确认替换')
    expect(calls.some(url => url.includes('expression-import-url'))).toBe(true)
    expect(host.textContent).toContain('已导入动画（68027 字节）')
  })

  it('switches between URL import and JSON paste', async () => {
    const host = await mount()

    expect(host.querySelector('input[type="url"]')).not.toBeNull()
    expect(host.querySelector('textarea')).toBeNull()

    button(host, '粘贴 JSON').click()
    await settle()
    expect(host.querySelector('textarea')).not.toBeNull()
    expect(host.querySelector('input[type="url"]')).toBeNull()

    button(host, 'URL 导入').click()
    await settle()
    expect(host.querySelector('input[type="url"]')).not.toBeNull()
  })

  it('shows the Host error instead of failing silently', async () => {
    expression = { state: 'none' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const href = String(url)
        calls.push(href)
        if (href.includes('/expression-import-url')) {
          return {
            status: 502,
            text: async () =>
              JSON.stringify({ ok: false, error: 'EXPRESSION_FETCH_FAILED', message: '下载动画失败：请求失败或超时' }),
          }
        }
        if (href.includes('/expression')) return respond(expression)
        return respond({})
      }),
    )

    const host = await mount()
    const input = host.querySelector('input[type="url"]') as HTMLInputElement
    setInput(input, 'https://fonts.gstatic.cn/s/e/notoemoji/latest/1f914/lottie.json')
    await settle()

    button(host, '从 URL 导入').click()
    await settle()

    expect(host.textContent).toContain('下载动画失败')
  })
})
