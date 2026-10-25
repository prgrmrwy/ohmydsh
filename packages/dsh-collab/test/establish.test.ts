import { describe, it, expect, afterEach } from 'vitest'
import { hostContext, start, ops, settle, tempRoot, bytes, type Host } from './support/world.js'
import { captureHost, ledger, managedSpace, records, scriptedAdapter, service } from './support/integrator.js'

const world = (run: (host: Host) => Promise<void>) => tempRoot('collab-est-', async root => { const host = hostContext(root); try { await run(host) } finally { await host.stop() } })
const MANAGED = { extra: { managedChannels: ['pet-locus'] } }
const PURPOSE = '主会话 的 Locus：主会话与它的群、话题子会话共享待办与结论。'
let restore: (() => void) | undefined
afterEach(() => { restore?.(); restore = undefined })

/** Count calls the kernel receives for the given methods. */
function spyKernel(kernel: any, methods: string[]) {
  const calls: Record<string, number> = Object.fromEntries(methods.map(m => [m, 0]))
  for (const method of methods) { const original = kernel[method].bind(kernel); kernel[method] = (...args: any[]) => { calls[method]!++; return original(...args) } }
  return calls
}
const summary = async (host: Host, spaceId: string) => (await records(host, spaceId)).map((r: any) => r.events.map((e: any) => [e.type, e.actor, e.channel ?? e.leader ?? null]))

describe('接入方以真实普通会话建立空间并接入自己', () => {
  it('establish-01：首次建立并授权', () => world(async host => {
    host.session('session-a', { live: true })
    await start(host, MANAGED)
    const handle = service(host).attach('pet-locus', scriptedAdapter().adapter)
    const A = host.live.get('session-a')
    expect(await handle.establish({ agent: A }, 'pet-locus-x', 'est-1', { name: 'main', purpose: PURPOSE })).toEqual({ spaceId: 'pet-locus-x' })
    const log = await records(host, 'pet-locus-x')
    expect(log.map((r: any) => r.receipt.cmdId)).toEqual(['est-1:create', 'est-1:allow'])
    const created = log[0].events.find((e: any) => e.type === 'space/created')
    expect(created).toMatchObject({ actor: 'main', leader: 'main', purpose: PURPOSE })
    expect(log[0].events.find((e: any) => e.type === 'member/joined').member.binding).toMatchObject({ channel: 'dsh-session', address: 'session-a' })
    expect(log[1].events).toEqual([{ type: 'manager/allowed', actor: 'main', channel: 'pet-locus' }])
  }))

  it('establish-02：中断后重试补齐', () => world(async host => {
    const captured = captureHost(); restore = captured.restore
    host.session('session-a', { live: true })
    await start(host, MANAGED)
    const handle = service(host).attach('pet-locus', scriptedAdapter().adapter)
    const A = host.live.get('session-a')
    const kernel: any = captured.seen.host!.service, allow = kernel.allowManager
    // Interrupt after createSpace committed, before the grant reaches the kernel.
    kernel.allowManager = async () => { kernel.allowManager = allow; throw new Error('interrupted') }
    expect((await handle.establish({ agent: A }, 'pet-locus-x', 'est-1', { name: 'main', purpose: PURPOSE })).error).toBeDefined()
    expect(await summary(host, 'pet-locus-x')).toEqual([[['space/created', 'main', 'main'], ['member/joined', 'main', null]]])
    expect(await handle.establish({ agent: A }, 'pet-locus-x', 'est-1', { name: 'main', purpose: PURPOSE })).toEqual({ spaceId: 'pet-locus-x' })
    expect(await summary(host, 'pet-locus-x')).toEqual([[['space/created', 'main', 'main'], ['member/joined', 'main', null]], [['manager/allowed', 'main', 'pet-locus']]])
    await settle()
    const before = await bytes(ledger(host, 'pet-locus-x'))
    expect(await handle.establish({ agent: A }, 'pet-locus-x', 'est-1', { name: 'main', purpose: PURPOSE })).toEqual({ spaceId: 'pet-locus-x' })
    expect(await bytes(ledger(host, 'pet-locus-x'))).toEqual(before)
  }))

  it('establish-03：托管成员不能建立', () => world(async host => {
    const captured = captureHost(); restore = captured.restore
    const { handle, L } = await managedSpace(host)
    const calls = spyKernel(captured.seen.host!.service, ['createSpace', 'allowManager'])
    expect(await handle.establish({ agent: L }, 'pet-locus-y', 'est-3', { name: 'main', purpose: PURPOSE })).toEqual({ error: { code: 'COLLAB_CALLER_UNAVAILABLE' } })
    expect(await handle.establish({ agent: L }, 's', 'est-3', { name: 'main', purpose: PURPOSE })).toEqual({ error: { code: 'COLLAB_CALLER_UNAVAILABLE' } })
    expect(calls).toEqual({ createSpace: 0, allowManager: 0 })
    expect(await bytes(ledger(host, 'pet-locus-y'))).toBeNull()
  }))

  it('establish-04：非 Leader 不能借此授权', () => world(async host => {
    host.session('session-a', { live: true }); host.session('session-b', { live: true }); host.session('session-c', { live: true })
    await start(host, MANAGED)
    const handle = service(host).attach('pet-locus', scriptedAdapter().adapter)
    const op = ops(host)
    expect((await op.create('session-b', 'S', 'b')).error).toBeUndefined()
    expect((await op.invite('session-b', 'S', 'c', 'session-c')).error).toBeUndefined()
    await settle()
    const before = await bytes(ledger(host, 'S'))
    const UNAVAILABLE = '{"error":{"code":"COLLAB_SPACE_UNAVAILABLE"}}'
    // A is not a member; C is a member but not the Leader. Neither may grant.
    expect(JSON.stringify(await handle.establish({ agent: host.live.get('session-a') }, 'S', 'est-4', { name: 'main', purpose: PURPOSE }))).toBe(UNAVAILABLE)
    expect(JSON.stringify(await handle.establish({ agent: host.live.get('session-c') }, 'S', 'est-4', { name: 'main', purpose: PURPOSE }))).toBe(UNAVAILABLE)
    await settle()
    expect(await bytes(ledger(host, 'S'))).toEqual(before)
  }))
})
