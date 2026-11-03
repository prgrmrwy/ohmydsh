/**
 * Pet's dsh-collab adapter: no managed member, `owns` for every locus main
 * session Pet ever created (history included) and nothing else.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { LocusCollab, type LocusMainRef } from '../src/host/collab/locus-collab.js'
import { openCollabWorld, type CollabWorld } from './support/collab-host.js'

let world: CollabWorld | undefined
afterEach(async () => { await world?.stop(); world = undefined })

const OLD: LocusMainRef = { locusMainSessionId: 'locus-main-old', workSessionId: 'work-a' }
const CURRENT: LocusMainRef = { locusMainSessionId: 'locus-main-current', workSessionId: 'work-a' }

describe('Pet 的 dsh-collab 适配器', () => {
  it('owns 对 Pet 创建过的全部 locus 主会话为真（含已替换的历史 main），对其它会话为假', () => {
    const collab = new LocusCollab({ directory: { list: () => [OLD, CURRENT] } })
    expect(collab.adapter.owns('locus-main-old')).toBe(true)
    expect(collab.adapter.owns('locus-main-current')).toBe(true)
    expect(collab.adapter.owns('work-a')).toBe(false)
    expect(collab.adapter.owns('some-child')).toBe(false)
    expect(collab.adapter.owns('')).toBe(false)
    expect(collab.adapter.owns(undefined as never)).toBe(false)
  })

  it('不再有代理成员：不认领任何地址、不解析任何调用者', async () => {
    const collab = new LocusCollab({ directory: { list: () => [CURRENT] } })
    expect(collab.adapter.claim('locus-main-current')).toBe(false)
    expect(collab.adapter.holds('locus-main-current')).toBe(false)
    expect(collab.adapter.resolveCaller({ id: 'locus-main-current' })).toBeUndefined()
    expect(() => collab.adapter.deliver({ name: 'x', address: 'y' }, { spaceId: 's', toSeq: 1, from: 'z' })).toThrow()
  })

  it('历史 main 不再是活会话时仍可被 manager 处置，但不能再以成员身份执行命令', async () => {
    world = await openCollabWorld()
    world.session(OLD.locusMainSessionId)
    world.session(OLD.workSessionId)
    const mains = [OLD]
    const collab = new LocusCollab({ directory: { list: () => mains } })
    collab.attach(world.service)
    expect((await collab.ensureSpace(OLD)).ok).toBe(true)
    expect((await collab.actAs(OLD.locusMainSessionId, 'req-1', {
      op: 'createItem',
      input: { itemId: 'todo-h', kind: 'request', assignee: 'work', title: 't', body: 'b', requiredAcks: [] },
    })).ok).toBe(true)

    // The old main goes away (unloaded): actAs refuses, the manager still disposes.
    world.unload(OLD.locusMainSessionId)
    const refused = await collab.actAs(OLD.locusMainSessionId, 'req-2', { op: 'sendMessage', input: { to: 'work', body: 'x', needsReply: false, notify: false } })
    expect(refused).toEqual({ ok: false, code: 'COLLAB_CALLER_UNAVAILABLE' })
    const disposed = await collab.currentHandle()!.disposeRequest(
      (await import('../src/host/collab/naming.js')).locusSpaceId(OLD.locusMainSessionId), 'dispose-1', { itemId: 'todo-h', progress: 'done' },
    )
    expect(disposed).not.toHaveProperty('error')
  })
})
