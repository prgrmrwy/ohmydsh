import { describe, expect, it } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { SYSTEM_CLOCK_CHANNEL, SYSTEM_CLOCK_NOW_ENDPOINT } from '../src/contract.js'
import { fetchHostSample } from '../src/client/section.js'

/** A fake Connection RPC caller returning a canned RpcResult. */
function fakeRpc(result: unknown): ClientConnectionRpc {
  return {
    call: async (channel: string, endpoint: string) => {
      expect(channel).toBe(SYSTEM_CLOCK_CHANNEL)
      expect(endpoint).toBe(SYSTEM_CLOCK_NOW_ENDPOINT)
      return result as never
    },
  } as unknown as ClientConnectionRpc
}

describe('fetchHostSample', () => {
  it('unwraps the business value from an ok result', async () => {
    const sample = { now: 1, timeZone: 'Asia/Shanghai', utcOffsetMinutes: -480, hostname: 'dev' }
    const value = await fetchHostSample(fakeRpc({ ok: true, value: sample }))
    expect(value).toEqual(sample)
  })

  it('throws the RpcResult error message on a business failure', async () => {
    await expect(
      fetchHostSample(fakeRpc({ ok: false, error: { code: 'internal', message: 'boom', details: {} } })),
    ).rejects.toThrow('boom')
  })

  it('throws the transport message when rpc.call rejects', async () => {
    const broken = {
      call: async () => { throw new Error('connection reset') },
    } as unknown as ClientConnectionRpc
    await expect(fetchHostSample(broken)).rejects.toThrow('connection reset')
  })
})
