import { expect, test } from 'vitest'
import { MagpieAdapter } from '../src/host/adapter.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { credentialsMock } from './support/credentials.js'

test('prepared old key remains redacted after rotation without a strong active-key lease', async () => {
  const credentials = credentialsMock('old-prepared-key')
  const runtime = new MagpieRuntime(credentials.service)
  const adapter = new MagpieAdapter(runtime)
  const signal = new AbortController()
  try {
    const prepared = await adapter.prepareCall('dsh-magpie-connector', 'example', signal.signal)
    credentials.change('new-key')
    const op = await runtime.beginOperation(); op.release()
    expect(runtime.redact('old-prepared-key')).toBe('[redacted]')
    expect(prepared.model.id).toBe('example')
    signal.abort()
    expect(runtime.redact('old-prepared-key')).toBe('old-prepared-key')
  } finally { await runtime.dispose() }
})

test('abandoned preparation does not retain a key in runtime active-operation state', async () => {
  const runtime = new MagpieRuntime(credentialsMock('prepared-key').service)
  const adapter = new MagpieAdapter(runtime)
  try {
    await adapter.prepareCall('dsh-magpie-connector', 'example')
    expect((runtime as unknown as { activeKeys: Map<string, number> }).activeKeys.size).toBe(0)
  } finally { await runtime.dispose() }
})
