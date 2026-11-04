import { describe, expect, it, vi } from 'vitest'
import { StopPreparation, type StopRequest } from '../src/host/locus/stop-preparation.js'

const identity = { hostPid: 100, bootId: 'boot-identity' }
const request = (action: StopRequest['action'] = 'prepare', deadlineAt = 2000): StopRequest => ({ v: 1, action, nonce: 'request-identity', expectedHostPid: identity.hostPid, expectedBootId: identity.bootId, deadlineAt })
function latch() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const tick = async () => { for (let n = 0; n < 5; n++) await Promise.resolve() }

describe('owned stop preparation', () => {
  it('acknowledges only after admission freeze and durable drain, deduplicating retries', async () => {
    const frozen = latch(); const drained = latch()
    const freeze = vi.fn(() => frozen.promise); const drain = vi.fn(() => drained.promise); const resume = vi.fn(async () => {})
    const stop = new StopPreparation(identity, { freeze, drain, resume, now: () => 1000 })
    const first = stop.request(request()); const repeated = stop.request(request())
    await tick()
    expect(freeze).toHaveBeenCalledTimes(1); expect(drain).not.toHaveBeenCalled()
    expect(await stop.request(request('status'))).toMatchObject({ phase: 'preparing' })
    await expect(stop.request(request('resume'))).rejects.toThrow('has not settled')
    frozen.resolve(); await tick(); expect(drain).toHaveBeenCalledTimes(1)
    let acknowledged = false; void first.then(() => { acknowledged = true })
    expect(acknowledged).toBe(false)
    drained.resolve()
    expect(await first).toMatchObject({ ...identity, nonce: 'request-identity', phase: 'prepared', preparedAt: 1000, expiresAt: 2000 })
    expect(await repeated).toMatchObject({ phase: 'prepared' })
    expect(resume).not.toHaveBeenCalled()
    expect(await stop.request(request('resume'))).toMatchObject({ phase: 'active' })
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it.each(['pid', 'boot', 'nonce', 'extra', 'deadline'] as const)('rejects %s wire mismatch before freezing', async mismatch => {
    const freeze = vi.fn(async () => {})
    const stop = new StopPreparation(identity, { freeze, drain: async () => {}, resume: async () => {}, now: () => 1000 })
    const body: Record<string, unknown> = { ...request() }
    if (mismatch === 'pid') body.expectedHostPid = 101
    if (mismatch === 'boot') body.expectedBootId = 'other-boot'
    if (mismatch === 'nonce') body.nonce = ''
    if (mismatch === 'extra') body.childSessionId = 'foreign-child'
    if (mismatch === 'deadline') body.deadlineAt = 999
    await expect(stop.request(body)).rejects.toThrow()
    expect(freeze).not.toHaveBeenCalled()
  })

  it('does not announce prepared or unfreeze after durable close failure', async () => {
    const resume = vi.fn(async () => {})
    const stop = new StopPreparation(identity, { freeze: async () => {}, drain: async () => { throw new Error('durability-failed') }, resume, now: () => 1000 })
    await expect(stop.request(request())).rejects.toThrow('durability-failed')
    expect(await stop.request(request('status'))).toMatchObject({ phase: 'failed' })
    expect(resume).not.toHaveBeenCalled()
    await stop.request(request('resume')); expect(resume).toHaveBeenCalledTimes(1)
  })

  it('keeps expired preparation frozen until an explicit recovery request', async () => {
    let now = 1000
    const drained = latch(); const resume = vi.fn(async () => {})
    const stop = new StopPreparation(identity, { freeze: async () => {}, drain: () => drained.promise, resume, now: () => now })
    const result = stop.request(request('prepare', 1010))
    await tick(); now = 1011; drained.resolve()
    await expect(result).rejects.toThrow('expired')
    expect(resume).not.toHaveBeenCalled()
    await stop.request(request('resume', 2011)); expect(resume).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a prepared ticket while dispatch is resuming', async () => {
    const resumed = latch()
    const stop = new StopPreparation(identity, { freeze: async () => {}, drain: async () => {}, resume: () => resumed.promise, now: () => 1000 })
    await stop.request(request())
    const recovery = stop.request(request('resume'))
    await expect(stop.request(request())).rejects.toThrow('finish recovery')
    expect(await stop.request(request('status'))).toMatchObject({ phase: 'resuming' })
    resumed.resolve(); await recovery
    expect(await stop.request(request('status'))).toMatchObject({ phase: 'active' })
  })

  it('refuses a second operation and disposed tickets', async () => {
    const stop = new StopPreparation(identity, { freeze: async () => {}, drain: async () => {}, resume: async () => {}, now: () => 1000 })
    await stop.request(request())
    await expect(stop.request({ ...request(), nonce: 'different-request' })).rejects.toThrow('Another')
    expect(await stop.request({ ...request('status'), nonce: 'different-request' })).toMatchObject({ phase: 'prepared', operationNonce: 'request-identity', preparedAt: 1000, expiresAt: 2000 })
    // A launcher that lost its nonce can still recover a settled operation.
    expect(await stop.request({ ...request('resume'), nonce: 'different-request' })).toMatchObject({ phase: 'active', operationNonce: null })
    expect(await stop.request(request('status'))).toMatchObject({ phase: 'active', operationNonce: null })
    stop.dispose()
    await expect(stop.request(request('status'))).rejects.toThrow('closed')
  })
})
