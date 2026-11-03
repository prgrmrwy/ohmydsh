import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { apply } from '../src/client/index.js'
import { fakeLocale } from './fake-locale.js'

it('registers a bounded settings contribution with disposer-owned navigation adapter', () => {
  const registrations: { name: string; id: string; order: number; label?: () => string }[] = []
  const effects: unknown[] = []
  const ctx = {
    connection: { rpc: {} },
    locale: fakeLocale('zh').service,
    effect: (effect: () => unknown) => { effects.push(effect); return effect() },
    slots: { inject: (_name: string, callback: () => unknown) => callback(), register: (options: typeof registrations[number]) => { registrations.push(options); return () => {} } },
  }
  apply(ctx as never)
  const settings = registrations.find(item => item.name === 'settings.section')!
  expect({ id: settings.id, label: settings.label?.(), order: settings.order }).toEqual({ id: 'auto-model-routing', label: '自动模型路由', order: 300 })
  // Two effects: the locale dictionaries and the navigation-icon adapter.
  expect(effects).toHaveLength(2)
  const source = readFileSync(new URL('../src/client/settings-section.ts', import.meta.url), 'utf8')
  expect(source).not.toContain('selectModel(')
  expect(source).not.toContain('ui-model-selection')
  expect(source).toContain('portal: true')
})
