// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Tab, type TabPlatform } from '../src/client/Tab.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A platform that satisfies every precondition (D11) so the address behaviour is isolated. */
const supportedPlatform: TabPlatform = {
  hasServiceWorker: () => true,
  hasNavigation: () => true,
  registerServiceWorker: async () => undefined,
  cleanupStaleRegistrations: async () => undefined,
  unregisterServiceWorker: async () => undefined,
}

let container: HTMLDivElement
let root: Root

async function mountTab(): Promise<void> {
  await act(async () => {
    root.render(<Tab platform={supportedPlatform} frameId="f-test" />)
  })
}
const input = (): HTMLInputElement => {
  const el = container.querySelector<HTMLInputElement>('input[data-dshls-address]')
  if (el === null) throw new Error('address input not found')
  return el
}
const iframe = (): HTMLIFrameElement | null => container.querySelector<HTMLIFrameElement>('iframe[data-dshls]')
async function submit(text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input().form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
const errorText = (): string => container.querySelector('[role="alert"]')?.textContent ?? ''

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('地址栏输入解析与显示', () => {
  it('spec Scenario "输入本机地址后加载对应代理并显示直接地址"', async () => {
    await mountTab()
    expect(iframe()).toBeNull() // nothing loads before the user submits an address
    await submit('localhost:5173/app?x=1#top')
    expect(iframe()?.getAttribute('src')).toBe('/dsh-local-service/p/5173/app?x=1#top')
    expect(input().value).toBe('http://127.0.0.1:5173/app?x=1#top')
  })

  it('spec Scenario "默认端口不被折叠"', async () => {
    await mountTab()
    await submit('http://localhost:80/')
    expect(iframe()?.getAttribute('src')).toBe('/dsh-local-service/p/80/')
  })

  it('spec Scenario "IPv6 回环地址连接 Host 的 ::1"', async () => {
    await mountTab()
    await submit('[::1]:8080/')
    expect(iframe()?.getAttribute('src')).toBe('/dsh-local-service/p6/8080/')
    expect(input().value).toBe('http://[::1]:8080/')
  })

  it('spec Scenario "非法输入不加载"', async () => {
    await mountTab()
    await submit('127.0.0.1:5173/ok')
    const shown = iframe()?.getAttribute('src')
    expect(shown).toBe('/dsh-local-service/p/5173/ok') // positive control: a valid address does load
    const cases: Array<[string, string]> = [
      ['http://example.com:8080/', '仅支持本机地址'],
      ['http://user@127.0.0.1:5173/', '地址不能包含用户信息'],
      ['127.0.0.1:70000', '端口无效'],
      ['127.0.0.1', '需要写明端口'],
    ]
    for (const [text, message] of cases) {
      await submit(text)
      expect(iframe()?.getAttribute('src')).toBe(shown)
      expect(errorText()).toBe(message)
    }
    // More rejected shapes keep the iframe untouched as well.
    for (const text of ['https://127.0.0.1:5173/', 'http://127.0.0.1:5173\\x', 'http://127.0.0.1:5173/\u0001']) {
      await submit(text)
      expect(iframe()?.getAttribute('src')).toBe(shown)
      expect(errorText()).not.toBe('')
    }
  })
})
