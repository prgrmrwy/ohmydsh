/**
 * The preamble decision against the REAL v20 durable Delivery ledger
 * (owner A's LocusRepositoryV20).
 *
 * `preamblePosition` is unit-tested in locus-delivery-prompt.test.ts; this file
 * proves the evidence chain it depends on actually exists in the Host: an
 * accepted Delivery is durable WITHOUT an inbox binding (accept precedes
 * rendering), a queued one carries the binding, and a delivery that never
 * bound never counts as proof. That is the whole difference between
 * "rendered" and "delivered".
 */

import { describe, expect, it } from 'vitest'
import { renderLocusDeliveryFor, type LocusPromptRecordFacts } from '../src/host/locus/context.js'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import type { LocusDomain } from '../src/host/locus/persistence-v20.js'

const ENDPOINT = { chatId: 'oc_preamble' } as const
const LOCUS = 'locus-preamble'
const MAIN = 'session-main'
const CHILD = 'session-child'

/** In-memory domain, same shim as owner A's v20 tests; survives a repository "restart". */
function memoryDomain(): LocusDomain {
  const tables = new Map<string, Map<string, unknown>>()
  const table = (name: string) => {
    let map = tables.get(name)
    if (map === undefined) {
      map = new Map()
      tables.set(name, map)
    }
    return {
      get: (key: string) => map!.get(key),
      entries: () => map!.entries(),
      keys: () => map!.keys(),
      get size() { return map!.size },
      put: async (key: string, value: unknown) => { map!.set(key, value) },
      delete: async (key: string) => map!.delete(key),
    }
  }
  return {
    table,
    supportsTransaction: true,
    transaction: async (body: (tx: { put(t: string, k: string, v: unknown): void; delete(t: string, k: string): void }) => void) => {
      body({ put: (t, k, v) => { table(t).put(k, v) }, delete: (t, k) => { table(t).delete(k) } })
    },
  } as unknown as LocusDomain
}

async function boot(accessMode: 'read-only' | 'danger-full-access' = 'danger-full-access') {
  const domain = memoryDomain()
  await domain.table('loci').put(ENDPOINT.chatId, {
    endpoint: ENDPOINT, locusId: LOCUS, sessionId: CHILD, state: 'active', accessMode,
    revision: 1, createdAt: 1, updatedAt: 1, locusMainSessionId: MAIN, workspaceId: 'workspace-preamble',
  })
  return { domain, repository: new LocusRepositoryV20(domain, { now: () => 5 }) }
}

const correlation = { endpoint: ENDPOINT, locusId: LOCUS, sessionId: CHILD }

async function accept(repository: LocusRepositoryV20, messageId: string, acceptedAt: number): Promise<string> {
  const accepted = await repository.acceptDelivery({
    ...correlation, messageId, senderOpenId: 'ou_owner', text: `text ${messageId}`,
    replyTarget: { chatId: ENDPOINT.chatId, messageId }, acceptedAt,
  } as never)
  return accepted.record.deliveryId
}

/** Claim the current Delivery and commit its inbox binding: the durable delivery proof. */
async function bind(repository: LocusRepositoryV20, deliveryId: string, inboxMessageId: string): Promise<void> {
  const acceptedAt = repository.getDelivery(deliveryId)!.acceptedAt
  await repository.claimCurrentDelivery({ ...correlation, now: acceptedAt + 1 } as never)
  await repository.bindQueued({ ...correlation, deliveryId, executionId: `exec-${deliveryId}`, inboxMessageId, queuedAt: acceptedAt + 2 })
}

/** Render exactly the way the Host wiring does: durable row + deliveries. */
function render(repository: LocusRepositoryV20, messageId: string): string {
  const row = repository.getRow(ENDPOINT)
  if (row === undefined || !('locusMainSessionId' in row)) throw new Error('group row missing')
  const current = repository.findDeliveryByMessageId(messageId)
  const facts: LocusPromptRecordFacts = {
    locusId: row.locusId,
    endpoint: row.endpoint,
    locusMainSessionId: row.locusMainSessionId,
    sessionId: row.sessionId,
    workspaceId: row.workspaceId,
    state: row.state,
    revision: row.revision,
    accessMode: row.accessMode,
  }
  return renderLocusDeliveryFor({
    record: facts,
    message: { messageId, senderOpenId: 'ou_owner', text: `text ${messageId}`, replyTarget: { chatId: ENDPOINT.chatId, messageId } },
    deliveries: repository.listDeliveries(row.locusId),
    ...(current === undefined ? {} : { currentDeliveryId: current.deliveryId }),
  })
}

describe('preamble position over the durable v20 ledger', () => {
  it('spec Scenario "首次投递收到完整前言"', async () => {
    const { repository } = await boot()
    await accept(repository, 'om_first', 10)
    // Accepted is durable admission without an inbox binding.
    expect(repository.findDeliveryByMessageId('om_first')?.inboxMessageId).toBeUndefined()

    const prompt = render(repository, 'om_first')
    expect(prompt).toContain('### Endpoint')
    expect(prompt).toContain('### Access mode')
    expect(prompt).toContain('访问模式：danger-full-access')
    expect(prompt).not.toContain('沿用本 child 首次投递')
  })

  it('spec Scenario "绑定已提交但控制回执丢失"', async () => {
    const { repository } = await boot()
    const first = await accept(repository, 'om_first', 10)
    await bind(repository, first, 'inbox-1')
    // The control receipt is lost; the committed binding alone is the proof.
    await accept(repository, 'om_second', 20)

    const prompt = render(repository, 'om_second')
    expect(prompt).not.toContain('### Endpoint')
    expect(prompt).toContain('om_second')
  })

  it('spec Scenario "队列已接受但持久绑定失败"', async () => {
    const { repository } = await boot()
    // The queue may have taken it, but the binding never committed.
    await accept(repository, 'om_lost', 10)
    await repository.claimCurrentDelivery({ ...correlation, now: 11 } as never)
    await accept(repository, 'om_next', 20)

    const prompt = render(repository, 'om_next')
    expect(prompt).toContain('### Endpoint')
    expect(prompt).toContain('### Access mode')
  })

  it('backlog 中已有其它已接受投递: accepted-but-unbound rows never consume the preamble', async () => {
    const { repository } = await boot()
    await accept(repository, 'om_queued_a', 10)
    await accept(repository, 'om_queued_b', 20)
    expect(render(repository, 'om_queued_b')).toContain('### Endpoint')
  })

  it('spec Scenario "第二次投递不重复前言但声明档位"', async () => {
    for (const mode of ['read-only', 'danger-full-access'] as const) {
      const { repository } = await boot(mode)
      const first = await accept(repository, 'om_first', 10)
      await bind(repository, first, 'inbox-1')
      await accept(repository, 'om_second', 20)

      const prompt = render(repository, 'om_second')
      expect(prompt).not.toContain('### Endpoint')
      expect(prompt).toContain(`访问模式：${mode}`)
      expect(prompt).toContain('### Reply target (current delivery only)')
      expect(prompt).toContain('om_second')
    }
  })

  it('重启后按送达证据决定: the proof survives a repository restart', async () => {
    const { domain, repository } = await boot()
    const first = await accept(repository, 'om_first', 10)
    await bind(repository, first, 'inbox-1')

    const reopened = new LocusRepositoryV20(domain, { now: () => 30 })
    await accept(reopened, 'om_after_restart', 30)
    const prompt = render(reopened, 'om_after_restart')
    expect(prompt).not.toContain('### Endpoint')
    expect(prompt).toContain('访问模式：danger-full-access')
  })

  it('spec Scenario "受既有缺陷影响的 child"', async () => {
    // A bound Delivery exists although that child never got a full preamble:
    // nothing re-sends it, but every delivery still states the access mode.
    const { repository } = await boot('read-only')
    const first = await accept(repository, 'om_defect', 10)
    await bind(repository, first, 'inbox-defect')
    for (const [messageId, at] of [['om_a', 20], ['om_b', 30]] as const) {
      await accept(repository, messageId, at)
      const prompt = render(repository, messageId)
      expect(prompt).not.toContain('### Endpoint')
      expect(prompt).toContain('访问模式：read-only')
    }
  })
})
