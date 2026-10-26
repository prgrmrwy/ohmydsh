import { expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, deferred, json } from './support/gateway.js'

test('own credential event invalidates old state before the credential write promise settles', async () => {
  const gateway = await createGateway()
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'OLD' }] }))
  const credentials = credentialsMock('old-key')
  const committed = deferred(), release = deferred()
  const originalSet = credentials.service.set
  credentials.service.set = async (...args) => { await originalSet(...args); committed.resolve(); await release.promise }
  const store = new SettingsStore(); store.value.baseUrl = gateway.baseUrl
  const runtime = new MagpieRuntime(credentials.service, store)
  credentials.onChange(() => runtime.invalidateCredential())
  await runtime.start()
  const previous = runtime.current
  previous.magpieCards = { cards: [{ provider: 'old' }] }
  const write = runtime.settings({ key: 'new-key' })
  try {
    await committed.promise
    expect(runtime.current).not.toBe(previous)
    expect(runtime.current.catalog).toEqual([])
    expect(runtime.current.magpieCards).toBeUndefined()
    expect(previous.bgAbort.signal.aborted).toBe(true)
    expect((await (await runtime.settings()).json()).groups).toEqual([])
  } finally { release.resolve(); await write; await runtime.dispose(); await gateway.close() }
})
