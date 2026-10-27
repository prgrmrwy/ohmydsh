import { expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { CardsController } from '../src/host/cards.js'
import { SettingsStore } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, json } from './support/gateway.js'

for (const endpoint of ['catalog', 'cards'] as const) {
  for (const format of ['json', 'text'] as const) {
    for (const retainOldKey of [false, true]) {
      test(`${endpoint} non-2xx ${format} redacts decoded current${retainOldKey ? ' and active old' : ''} keys`, async () => {
        const key = 'mk-"quoted\\key'
        const oldKey = 'old-"quoted\\key'
        const gateway = await createGateway()
        const credentials = credentialsMock(retainOldKey ? oldKey : key)
        const store = new SettingsStore(); store.value.baseUrl = gateway.baseUrl
        const runtime = new MagpieRuntime(credentials.service, store)
        let oldOperation: Awaited<ReturnType<typeof runtime.beginOperation>> | undefined
        gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'example' }] }))
        try {
          if (retainOldKey) {
            oldOperation = await runtime.beginOperation()
            await runtime.start()
            credentials.change(key)
          }
          const message = `invalid Bearer ${key}${retainOldKey ? `; old Bearer ${oldKey}` : ''}`
          const safeMessage = `invalid Bearer [redacted]${retainOldKey ? '; old Bearer [redacted]' : ''}`
          const body = { error: { message, details: [message, { reason: message }] } }
          const safeBody = { error: { message: safeMessage, details: [safeMessage, { reason: safeMessage }] } }
          const status = endpoint === 'catalog' ? 401 : 403
          const path = endpoint === 'catalog' ? '/v1/models' : '/v1/magpie/quotas/cards'
          gateway.handlers.set(`GET ${path}`, format === 'json' ? json(body, status) : res => {
            res.writeHead(status, { 'content-type': 'text/plain' }); res.end(message)
          })
          await runtime.start()
          const response = endpoint === 'catalog' ? await runtime.settings() : await new CardsController(runtime).get()
          const output = await response.json()
          const error: string = endpoint === 'catalog' ? output.lastSyncError : output.error
          expect(response.status).toBe(endpoint === 'catalog' ? 200 : 403)
          expect(endpoint === 'catalog' ? output.lastSyncErrorKind : output.status).toBe(endpoint === 'catalog' ? 'unauthorized' : 'forbidden')
          const detail = error.slice(`HTTP ${status}: `.length)
          if (format === 'json') expect(JSON.parse(detail)).toEqual(safeBody)
          else expect(detail).toBe(safeMessage)
          expect(error).toBe(`HTTP ${status}: ${format === 'json' ? JSON.stringify(safeBody) : safeMessage}`)
          expect(gateway.requests.some(request => request.path === path)).toBe(true)
        } finally {
          oldOperation?.release()
          await runtime.dispose()
          await gateway.close()
        }
      })
    }
  }
}
