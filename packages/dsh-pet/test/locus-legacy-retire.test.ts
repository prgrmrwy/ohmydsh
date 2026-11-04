import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { admitLocusEvent, createDurableLocusAuthorizationResolver } from '../src/host/locus/admission.js'
import { buildLocusRecord } from '../src/host/locus/aggregate.js'
import { reconcileLocusChildren } from '../src/host/locus/reconcile.js'
import { createLocusResolution } from '../src/host/locus/resolution.js'
import { PetStorageBackend } from '../src/host/storage/backend.js'
import { PET_DOMAIN_NAME, PET_DOMAIN_VERSION, petDomainSpec } from '../src/host/spec.js'
import { openThreeTier, type ThreeTier } from './support/three-tier.js'

const SCRIPT = new URL('../scripts/migrate-state-version.mjs', import.meta.url).pathname

function currentTables(): string[] {
  return Object.keys((petDomainSpec as unknown as { tables: Record<string, unknown> }).tables)
}

describe('旧模型入口按退休规则处理', () => {
  it('升级只加表', async () => {
    expect(PET_DOMAIN_VERSION).toBe(18)
    const dir = mkdtempSync(path.join(tmpdir(), 'pet-locus-v18-'))
    const file = path.join(dir, 'state.sqlite')
    const previousTables = currentTables().filter(table => table !== 'locus_mains')
    expect(currentTables()).toContain('locus_mains')

    // A v17 medium: exactly the pre-existing tables, with rows that must not move.
    const seeded = new PetStorageBackend(file)
    const unit = await seeded.kv.open({ name: PET_DOMAIN_NAME, version: 17, tables: previousTables })
    const legacyLocus = '{"id":"locus-old","parentSessionId":"session-user","opaque":[1,2,3]}'
    await unit.putRecord('loci', 'locus-old', JSON.parse(legacyLocus))
    await unit.putRecord('locus_deliveries', 'delivery-old', { opaque: true })
    await unit.putRecord('tasks', 'task-1', { id: 'task-1' })
    await unit.close()
    await seeded.close()

    const snapshot = (): Record<string, unknown[]> => {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        const out: Record<string, unknown[]> = {}
        for (const table of previousTables) {
          out[table] = db.prepare(`SELECT key, value FROM "u_${PET_DOMAIN_NAME}_${table}" ORDER BY key`).all()
        }
        return out
      } finally { db.close() }
    }
    const before = snapshot()

    const output = execFileSync(process.execPath, [SCRIPT, '--db', file, '--yes'], { encoding: 'utf8' })
    expect(output).toContain('Restamped 17 → 18')

    // The offline migration itself adds the only new table; no Host boot is required.
    const offline = new DatabaseSync(file, { readOnly: true })
    try {
      expect(offline.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='u_dsh_pet_locus_mains'").get())
        .toEqual({ name: 'u_dsh_pet_locus_mains' })
    } finally { offline.close() }
    const reopened = new PetStorageBackend(file)
    const migrated = await reopened.kv.open({ name: PET_DOMAIN_NAME, version: PET_DOMAIN_VERSION, tables: currentTables() })
    const loaded = await migrated.loadAll()
    expect(loaded.tables.locus_mains).toEqual({})
    await migrated.close()
    await reopened.close()

    const db = new DatabaseSync(file, { readOnly: true })
    try {
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name)
      expect(tables).toContain(`u_${PET_DOMAIN_NAME}_locus_mains`)
      expect(db.prepare('SELECT version FROM units WHERE name = ?').get(PET_DOMAIN_NAME)).toEqual({ version: 18 })
    } finally { db.close() }
    expect(snapshot()).toEqual(before)
  })

  /** A row of the previous two-tier model: parent is the USER's session, no locus main. */
  async function withLegacyEntry(world: ThreeTier, chatId: string, threadId?: string) {
    const legacy = await world.durable.putLocus(buildLocusRecord({
      id: `locus-old-${chatId}`,
      endpoint: threadId === undefined ? { chatId } : { chatId, threadId },
      parentSessionId: 'user-session',
      childSessionId: `child-old-${chatId}`,
      childComposition: 'safe-v2',
      workspaceId: 'ws-1',
      source: 'explicit',
      createdAt: 1,
      updatedAt: 1,
    }))
    return legacy
  }

  function authorizationOf(world: ThreeTier) {
    return createDurableLocusAuthorizationResolver(
      {
        getLatestLocusByEndpoint: endpoint => {
          const record = world.durable.getLatestLocusByEndpoint(endpoint)
          if (record === undefined) return undefined
          const main = world.durable.getLocusMain(record.parentSessionId)
          return {
            id: record.id,
            state: record.state,
            parentSessionId: record.parentSessionId,
            ...(main === undefined ? { legacy: true } : { workSessionId: main.workSessionId }),
          }
        },
      },
      { find: () => undefined },
    )
  }

  const BOT = 'ou_bot'
  const OWNER = 'ou_owner'
  const event = (sender: string, chatId: string) => ({
    type: 'im.message.receive_v1',
    message_id: `om_${sender}`,
    chat_id: chatId,
    chat_type: 'group' as const,
    message_type: 'text',
    content: '@bot 看看这个',
    create_time: '2000',
    sender_id: sender,
    sender_type: 'user',
    mentions: [{ id: BOT, key: '@_user_1', name: 'bot' }],
  })
  const admissionContext = (world: ThreeTier) => ({
    botOpenId: BOT,
    allowOpenIds: [OWNER],
    watermark: 0,
    isDuplicate: () => false,
    authorization: authorizationOf(world),
  })

  it('旧入口首个授权 at', async () => {
    const world = await openThreeTier()
    try {
      const legacy = await withLegacyEntry(world, 'oc_old')
      const before = world.durable.getLocus(legacy.id)

      // Admission: the owner's @ is admitted and asks for initialization.
      const admitted = admitLocusEvent(event(OWNER, 'oc_old') as never, admissionContext(world) as never)
      expect(admitted).toMatchObject({ admit: true, needsInitialization: true, authorization: 'uninitialized' })

      // The read path never serves it (and never adopts its child) ...
      const provisioning = {
        ensureForDelivery: async ({ endpoint }: { endpoint: { chatId: string; threadId?: string } }) => {
          const ensured = await world.controller.ensureEntry(endpoint)
          return {
            id: ensured.locus.locusId,
            endpoint: ensured.locus.endpoint,
            generation: ensured.locus.generation,
            parentSessionId: ensured.locus.parentSessionId,
            ...(ensured.locus.workSessionId === undefined ? {} : { workSessionId: ensured.locus.workSessionId }),
            reservedChildSessionId: ensured.locus.reservedChildSessionId,
            workspaceId: ensured.locus.workspaceId,
            state: 'not-created' as const,
            permission: { desired: 'read' as const, effective: 'read' as const },
            ...(ensured.notice === undefined ? {} : { notice: ensured.notice }),
          }
        },
      }
      const resolution = createLocusResolution({
        store: world.durable,
        mains: { find: id => world.durable.getLocusMain(id) },
        provisioning: provisioning as never,
      })
      expect(() => resolution.resolveCurrent({ chatId: 'oc_old' })).toThrow(/cannot serve a delivery/)

      // ... but the delivery path builds the new structure the auto way.
      const established = await resolution.ensureForDelivery({
        endpoint: { chatId: 'oc_old' },
        messageId: 'om_first',
        signal: new AbortController().signal,
      })
      expect(established).toMatchObject({ state: 'not-created', generation: 2 })
      expect(established.notice).toMatch(/旧.*退休/)
      // A NEW work session in the default workspace — not the user's session the old row borrowed.
      expect(world.world.createdWorks).toHaveLength(1)
      expect(established.workSessionId).toBe(world.world.createdWorks[0])
      expect(established.workSessionId).not.toBe('user-session')
      expect(world.world.createdMains).toHaveLength(1)
      expect(world.world.spaces).toHaveLength(1)

      // The old row is history (retired by the successor), its child is left alone.
      expect(world.durable.getLocus(legacy.id)).toMatchObject({
        state: 'active',
        childSessionId: 'child-old-oc_old',
        parentSessionId: 'user-session',
      })
      expect(world.durable.getLocus(legacy.id)).toEqual(legacy)
      expect(before?.state).toBe('active')
      const probe = vi.fn(async () => ({ kind: 'usable' as const }))
      const invalidate = vi.fn(async () => undefined)
      await reconcileLocusChildren([before!], { store: { invalidate, clearBusy: async () => undefined }, probe: { check: probe } })
      expect(probe).not.toHaveBeenCalled()
      expect(invalidate).not.toHaveBeenCalled()
    } finally { await world.close() }
  })

  it('旧入口非授权 at', async () => {
    const world = await openThreeTier()
    try {
      const legacy = await withLegacyEntry(world, 'oc_old')

      const refused = admitLocusEvent(event('ou_member', 'oc_old') as never, admissionContext(world) as never)
      expect(refused).toMatchObject({ admit: false, reason: 'not-allowed-sender' })

      // Nothing was built, and the old row was not touched.
      expect(world.world.createdWorks).toEqual([])
      expect(world.world.createdMains).toEqual([])
      expect(world.durable.listLocusMains()).toEqual([])
      expect(world.durable.getLocus(legacy.id)).toEqual(legacy)
    } finally { await world.close() }
  })

  it('旧入口里所有者已停止的行不会被 at 复活', async () => {
    const world = await openThreeTier()
    try {
      const legacy = await withLegacyEntry(world, 'oc_stopped')
      await world.durable.stopLocus(legacy.id, 50)
      const admitted = admitLocusEvent(event(OWNER, 'oc_stopped') as never, admissionContext(world) as never)
      expect(admitted).toMatchObject({ admit: false, reason: 'retired-endpoint' })
      await expect(world.controller.ensureEntry({ chatId: 'oc_stopped' })).rejects.toMatchObject({
        code: 'GROUP_UNAVAILABLE',
      })
      expect(world.world.createdWorks).toEqual([])
    } finally { await world.close() }
  })

  it('旧话题入口在群先建立三层结构后建在同一 locus 主会话下', async () => {
    const world = await openThreeTier()
    try {
      const group = await withLegacyEntry(world, 'oc_old')
      const topic = await world.durable.putLocus(buildLocusRecord({
        id: 'locus-old-topic',
        endpoint: { chatId: 'oc_old', threadId: 'omt_old' },
        parentSessionId: 'user-session',
        childSessionId: 'child-old-topic',
        childComposition: 'safe-v2',
        workspaceId: 'ws-1',
        source: 'inherited',
        parentLocusId: group.id,
        createdAt: 2,
        updatedAt: 2,
      }))

      const moved = await world.controller.ensureEntry({ chatId: 'oc_old', threadId: 'omt_old' })

      const newGroup = world.durable.getLatestLocusByEndpoint({ chatId: 'oc_old' })
      expect(newGroup).toMatchObject({ generation: 2, state: 'not-created' })
      expect(moved.locus).toMatchObject({
        generation: 2,
        state: 'not-created',
        parentSessionId: newGroup!.parentSessionId,
        parentLocusId: newGroup!.id,
        replacesLocusId: topic.id,
      })
      expect(world.world.createdMains).toHaveLength(1)
      expect(world.durable.getLocus(topic.id)).toEqual(topic)
      expect(world.durable.getLocus(group.id)).toEqual(group)
    } finally { await world.close() }
  })
})
