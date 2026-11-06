// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { apply } from '../src/client/index.js'
import { fakeApi } from './client-support/fake-api.js'

/**
 * The real locale service (`@deepseek-ai/dsh-client-locale`) refuses a second
 * dictionary for a namespace it already holds:
 * `locale namespace "x" already has locale "zh"` (client.js `register`). A client
 * bundle rebuilt while the page is open re-applies this plugin against the same
 * long-lived locale service, so every `ctx.effect` from the first application
 * must release what it registered.
 */
function strictLocale() {
  const dictionaries = new Map<string, unknown>()
  return {
    register(namespace: string, dicts: unknown): () => void {
      if (dictionaries.has(namespace)) throw new Error(`locale namespace "${namespace}" already has locale "zh"`)
      dictionaries.set(namespace, dicts)
      return () => { dictionaries.delete(namespace) }
    },
    bind(namespace: string): (key: string) => string {
      return (key: string) => dictionaries.has(namespace) ? key : key
    },
  }
}

/** One client module generation: `effect` records every disposer the entry owns. */
function generation(locale: ReturnType<typeof strictLocale>) {
  const cleanups: (() => void)[] = []
  const registered: { name: string; id: string }[] = []
  const ctx = {
    slots: {
      inject: (_name: string, run: () => unknown) => { run() },
      register: (registration: { name: string; id: string }) => { registered.push(registration); return () => {} },
    },
    locale,
    get: () => undefined,
    effect: (run: () => () => void) => { cleanups.push(run()) },
  }
  return {
    registered,
    apply: () => apply(ctx as never, fakeApi({}).api),
    /** What the module system runs before importing the rebuilt bundle. */
    teardown: () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() },
  }
}

const SLOTS = [
  'settings.section#dsh-magpie-connector',
  'sidebar.footer.action#magpie-usage',
  'conversation.input.right#dsh-magpie-connector-speed',
]

it('重建后的客户端 bundle 可以重新 apply（语言字典随条目释放）', () => {
  const locale = strictLocale()
  const first = generation(locale)
  first.apply()
  expect(first.registered.map(r => `${r.name}#${r.id}`)).toEqual(SLOTS)
  first.teardown()

  const second = generation(locale)
  expect(() => second.apply()).not.toThrow()
  expect(second.registered.map(r => `${r.name}#${r.id}`)).toEqual(SLOTS)
  second.teardown()
})

it('卸载后不再占用语言命名空间', () => {
  const locale = strictLocale()
  const module = generation(locale)
  module.apply()
  module.teardown()
  // A fresh page-level registration must succeed: the teardown released the namespace.
  expect(() => locale.register('settings.magpie', { zh: {}, en: {} })).not.toThrow()
})
