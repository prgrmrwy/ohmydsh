// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bindLocale, en, resetLocale, type LocaleKey } from '../src/client/locales.ts'
import { Tab, type TabPlatform } from '../src/client/Tab.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const platform: TabPlatform = {
  hasServiceWorker: () => true,
  hasNavigation: () => true,
  registerServiceWorker: async () => undefined,
  cleanupStaleRegistrations: async () => undefined,
  unregisterServiceWorker: async () => undefined,
}
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  resetLocale()
})

const labels = (): string[] => [...container.querySelectorAll('.dshls-toolbar [aria-label]')].map((e) => e.getAttribute('aria-label') ?? '')

describe('界面本地化（zh 为默认，en 经 ctx.locale 绑定）', () => {
  it('falls back to Chinese when no locale is bound', async () => {
    await act(async () => { root.render(<Tab platform={platform} frameId="f-l" />) })
    expect(labels()).toEqual(expect.arrayContaining(['返回', '首页', '刷新', '打开']))
    expect(container.querySelector('h2')?.textContent).toBe('在 Host 上打开一个本机服务')
    expect(container.querySelector('input[data-dshls-address]')?.getAttribute('placeholder')).toBe('输入 Host 上的地址，例如 127.0.0.1:5173')
  })

  it('shows English toolbar names, home title and address errors once an English translator is bound', async () => {
    bindLocale((key: LocaleKey) => en[key])
    await act(async () => { root.render(<Tab platform={platform} frameId="f-l" />) })
    expect(labels()).toEqual(expect.arrayContaining(['Back', 'Home', 'Refresh', 'Open']))
    expect(labels().some((l) => /[一-龥]/.test(l))).toBe(false)
    expect(container.querySelector('h2')?.textContent).toBe(en.homeTitle)
    expect(container.querySelector('input[data-dshls-address]')?.getAttribute('placeholder')).toBe('Enter a Host address, e.g. 127.0.0.1:5173')
    expect(/[一-龥]/.test(container.querySelector('.dshls-tab')?.textContent ?? '')).toBe(false)
    const input = container.querySelector<HTMLInputElement>('input[data-dshls-address]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '127.0.0.1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.errPortRequired)
  })
})
