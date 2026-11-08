import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { apply } from '../src/client/index.js'
import { fakeLocale } from './fake-locale.js'

it('registers the settings page and its matching official icon contribution', () => {
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
  expect(registrations.filter(item => item.name === 'settings.section.icon')).toEqual([
    { name: 'settings.section.icon', id: 'auto-model-routing' },
  ])
  // Only dictionaries need an explicit effect; the registry owns the icon lifecycle.
  expect(effects).toHaveLength(1)
  const source = readFileSync(new URL('../src/client/settings-section.ts', import.meta.url), 'utf8')
  expect(source).not.toContain('selectModel(')
  expect(source).not.toContain('ui-model-selection')
  expect(source).toContain('portal: true')
})
