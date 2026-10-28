import { act } from 'react'
import type { Api, ApiRequest, ApiResponse } from '../../src/client/api.js'

export interface Call extends ApiRequest {}
type Handler = (request: ApiRequest) => ApiResponse | Promise<ApiResponse>

/** Scriptable stand-in for the host's /api/dsh-magpie-connector routes (design D10 shapes). */
export function fakeApi(handlers: Partial<Record<string, Handler>>) {
  const calls: Call[] = []
  const api: Api = async request => {
    calls.push(request)
    const handler = handlers[`${request.method} ${request.path}`]
    if (!handler) return { status: 404, body: { error: 'no handler' } }
    return handler(request)
  }
  return { api, calls }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

export const ok = (body: unknown): ApiResponse => ({ status: 200, body })

export const settingsView = (overrides: Record<string, unknown> = {}) => ({
  lines: [{
    id: 'a1b2c3d4', baseUrl: 'http://gateway.test/v1', accessMode: 'direct', complete: true,
    key: { configured: true, writable: true },
    access: { clientId: { configured: false, writable: true }, clientSecret: { configured: false, writable: true } },
    refs: { key: 'MAGPIE_LINE_A1B2C3D4_API_KEY', accessClientId: 'MAGPIE_LINE_A1B2C3D4_ACCESS_CLIENT_ID', accessClientSecret: 'MAGPIE_LINE_A1B2C3D4_ACCESS_CLIENT_SECRET' },
  }],
  activeLineId: 'a1b2c3d4',
  lastSyncAt: '2026-10-25T10:00:00Z',
  groups: [
    { provider: 'claude', models: [{ id: 'claude/claude-opus-5-5', name: 'Claude Opus 5.5', efforts: ['low', 'high'], visible: true }] },
    { provider: 'codex', models: [{ id: 'codex/gpt-6.1-sol', name: 'GPT 6.1 Sol', efforts: ['low', 'high', 'xhigh'], visible: true }] },
  ],
  visibleModels: {},
  defaultEfforts: {},
  ...overrides,
})

/** Let pending promises and React updates settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

/** Drive a controlled React input through the DOM, not a component callback. */
export function inputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export const text = (el: Element | null | undefined) => el?.textContent ?? ''

export function buttonByText(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find(b => b.textContent === label) as HTMLButtonElement | undefined
}
