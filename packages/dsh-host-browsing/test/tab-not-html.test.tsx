// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
})

/** Open 127.0.0.1:5173 so the tab owns an iframe, then hand it a fake proxied, un-injected document. */
async function loadFakeDocument(contentType: string, entries: unknown[]): Promise<void> {
  await act(async () => { root.render(<Tab platform={platform} frameId="f-test" />) })
  const input = container.querySelector<HTMLInputElement>('input[data-dshls-address]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '127.0.0.1:5173/data')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  const iframe = container.querySelector<HTMLIFrameElement>('iframe[data-dshls]')!
  const fake = {
    location: { href: 'http://localhost/dsh-local-service/p/5173/data', pathname: '/dsh-local-service/p/5173/data', replace: vi.fn() },
    document: { contentType },
    performance: { getEntriesByType: () => entries },
  }
  Object.defineProperty(iframe, 'contentWindow', { configurable: true, get: () => fake })
  await act(async () => { iframe.dispatchEvent(new Event('load')) })
}
const alertText = (): string => container.querySelector('[role="alert"]')?.textContent ?? ''

describe('非网页响应的提示', () => {
  it('spec Scenario "状态码不可读时只显示内容类型"', async () => {
    // Positive control: a readable status IS shown, so the "no number" assertions below can fail.
    await loadFakeDocument('application/json', [{ responseStatus: 404 }])
    expect(alertText()).toContain('这个地址返回的不是网页')
    expect(alertText()).toContain('application/json')
    expect(alertText()).toContain('404')
    await act(async () => root.unmount())
    root = createRoot(container)

    const unreadable: Array<[string, unknown[]]> = [
      ['no navigation entry', []],
      ['entry without responseStatus', [{}]],
      ['responseStatus 0', [{ responseStatus: 0 }]],
    ]
    for (const [label, entries] of unreadable) {
      await loadFakeDocument('application/json', entries)
      const text = alertText()
      expect(text, label).toContain('这个地址返回的不是网页')
      expect(text, label).toContain('application/json')
      expect(text, label).not.toContain('状态')
      await act(async () => root.unmount())
      root = createRoot(container)
    }
  })
})
