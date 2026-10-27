import { expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { SettingsController } from '../src/host/routes.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, deferred, json } from './support/gateway.js'

test('combined resync and effort updates do not overwrite a concurrent effort for another model', async () => {
  const gateway = await createGateway()
  const store = new SettingsStore()
  store.value.baseUrl = gateway.baseUrl
  const models = { data: [{ id: 'a', reasoning_levels: ['high'] }, { id: 'b', reasoning_levels: ['high'] }] }
  gateway.handlers.set('GET /v1/models', json(models))
  const runtime = new MagpieRuntime(credentialsMock('test-key').service, store)
  await runtime.start()
  const controller = new SettingsController(runtime)
  const entered = deferred(), release = deferred()
  gateway.handlers.set('GET /v1/models', async response => { entered.resolve(); await release.promise; json(models)(response, {} as never) })
  try {
    const first = controller.handle({ resync: true, defaultEffort: { model: 'a', effort: 'high' } })
    await entered.promise
    const second = controller.handle({ defaultEffort: { model: 'b', effort: 'high' } })
    await Promise.resolve()
    release.resolve()
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    expect(store.value.defaultEfforts).toEqual({ a: 'high', b: 'high' })
  } finally { release.resolve(); await runtime.dispose(); await gateway.close() }
})
