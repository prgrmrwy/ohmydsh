import { describe, it, expect } from 'vitest'
import { hostContext, ops, settle, tempRoot, bytes, type Host } from './support/world.js'
import { codeOf, gate, ledger, managedSpace } from './support/integrator.js'

const world = (run: (host: Host) => Promise<void>) => tempRoot('collab-smode-', async root => { const host = hostContext(root); try { await run(host) } finally { await host.stop() } })
/** Deliveries to `member` once each has a recorded outcome (completion is persisted asynchronously). */
const deliveriesTo = async (host: Host, member: string) => {
  const read = async () => Object.values((await ops(host).overview('session-a', 's')).deliveries as Record<string, any>).filter(d => d.member === member)
  await expect.poll(async () => { const list = await read(); return list.length > 0 && list.every(d => d.outcome) }).toBe(true)
  return read()
}

describe('接入方可为普通会话收件人注册投递方式', () => {
  it('smode-01：询问方式交给接入方的独立轮次', () => world(async host => {
    const { handle, L } = await managedSpace(host)
    const calls: [string, any][] = []
    handle.registerSessionMode('pet-locus:inquiry', (sessionId: string, pointer: any) => { calls.push([sessionId, pointer]) })
    const followups = host.counts.followup
    const sent = await handle.command({ agent: L }, 's', 'ask-1', { op: 'sendMessage', input: { to: 'aily', body: 'which group?', needsReply: true, mode: 'pet-locus:inquiry' } })
    expect(sent.error).toBeUndefined()
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toBe('session-a')
    expect(calls[0]![1]).toMatchObject({ spaceId: 's', toSeq: sent.seq, from: 'locus-a', mode: 'pet-locus:inquiry' })
    expect(JSON.stringify(calls[0]![1])).not.toContain('which group?')
    expect(host.counts.followup).toBe(followups)
    const [delivery] = await deliveriesTo(host, 'aily')
    expect(delivery).toMatchObject({ mode: 'pet-locus:inquiry', outcome: 'succeeded' })
  }))

  it('smode-02：方式注销后投递失败而不降级', () => world(async host => {
    const { handle, L } = await managedSpace(host)
    let handled = 0
    handle.registerSessionMode('pet-locus:inquiry', () => { handled++ })
    const g = gate(), resolver = host.defaultResolver()
    host.setResolver(async id => { await g.wait(); return resolver(id) })
    const followups = host.counts.followup
    const sent = await handle.command({ agent: L }, 's', 'ask-2', { op: 'sendMessage', input: { to: 'aily', body: 'q', needsReply: true, mode: 'pet-locus:inquiry' } })
    expect(sent.error).toBeUndefined()
    await g.reached
    handle.dispose()
    g.release()
    await settle()
    expect(handled).toBe(0)
    expect(host.counts.followup).toBe(followups)
    const [delivery] = await deliveriesTo(host, 'aily')
    expect(delivery).toMatchObject({ mode: 'pet-locus:inquiry', outcome: 'failed' })
  }))

  it('smode-03：未注册的方式在发送时被拒', () => world(async host => {
    const { handle, L } = await managedSpace(host)
    handle.registerSessionMode('pet-locus:inquiry', () => {})
    const before = await bytes(ledger(host, 's'))
    expect(await handle.command({ agent: L }, 's', 'ask-3', { op: 'sendMessage', input: { to: 'aily', body: 'q', needsReply: true, mode: 'pet-locus:other' } })).toEqual({ error: { code: 'COLLAB_MODE_UNSUPPORTED' } })
    expect(await bytes(ledger(host, 's'))).toEqual(before)
  }))

  it('smode-04：不能注册他人前缀', () => world(async host => {
    const { handle } = await managedSpace(host)
    for (const mode of ['dsh-session:x', 'other:inquiry', 'pet-locus', 'pet-locus:Bad', 'pet-locus:']) {
      expect(await codeOf(() => handle.registerSessionMode(mode, () => {}))).toBe('COLLAB_BAD_MODE')
    }
    handle.registerSessionMode('pet-locus:inquiry', () => {})
    expect(await codeOf(() => handle.registerSessionMode('pet-locus:inquiry', () => {}))).toBe('COLLAB_MODE_TAKEN')
  }))
})
