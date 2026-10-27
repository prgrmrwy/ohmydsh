import { expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { SettingsController } from '../src/host/routes.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, json } from './support/gateway.js'

test('HTTP settings remains valid JSON with a literal quote or backslash credential', async () => {
  for (const key of ['"', '\\']) {
    const gateway = await createGateway()
    gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'safe-model', display_name: `prefix ${key} suffix` }] }))
    const store = new SettingsStore(); store.value.baseUrl = gateway.baseUrl
    const runtime = new MagpieRuntime(credentialsMock(key).service, store)
    try {
      await runtime.start()
      const response = await new SettingsController(runtime).handle()
      const view = await response.json()
      expect(view.groups[0].models[0].name).toBe('prefix [redacted] suffix')
      expect(view.key.configured).toBe(true)
    } finally { await runtime.dispose(); await gateway.close() }
  }
})

test('JSON error property names cannot reflect current credentials', async () => {
  const key = 'mk-"property\\key'
  const runtime = new MagpieRuntime(credentialsMock(key).service)
  const op = await runtime.beginOperation()
  try {
    const parsed = JSON.parse(runtime.formatErrorBody(JSON.stringify({ error: { [key]: 'invalid' } })))
    expect(Object.keys(parsed.error)).toEqual(['[redacted]'])
  } finally { op.release(); await runtime.dispose() }
})
