/**
 * Test harness: an in-memory `KvFacet` backend plus a real `DomainFacility`.
 *
 * Repository tests run against the ACTUAL DSH domain layer — real zod
 * validation at the durable boundary, the real per-domain write chain and
 * real change events — so an invariant that only holds against a hand-rolled
 * fake cannot pass here. Only the medium is substituted.
 */

import { Context } from '@deepseek-ai/cordis'
import Storage, {
  storageBackendServiceKey,
  type KvUnit,
  type KvUnitDescriptor,
} from '@deepseek-ai/dsh-storage'
// The domain layer ships as a plugin MODULE (`name`/`inject`/`apply`), not a
// default-exported class, so it is loaded as a namespace object.
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { PetRepository } from '../src/host/repository.js'
import { petDomainSpec, PET_DOMAIN_NAME } from '../src/host/spec.js'
import { withAtomicWrites } from '../src/host/storage/atomic-domain.js'

/** Serialized medium contents, so a "restart" can reopen the same bytes. */
export interface MemoryMedium {
  tables: Record<string, Record<string, string>>
  global: string | null
  /** Version stamped at first materialization; drives `version-mismatch`. */
  version?: number
}

/** Create an empty medium. */
export function emptyMedium(): MemoryMedium {
  return { tables: {}, global: null }
}

/** Faults a test can inject into the medium to prove fail-closed behavior. */
export interface MediumFaults {
  /** Reject every write with this error. */
  failWrites?: Error
  /** Reject the Nth write, allowing failure-injection compensation tests. */
  failOnWriteNumber?: number
  /** Optional injected error for the counted write. */
  failOnWriteError?: Error
  /**
   * Model a medium WITHOUT atomic batches, so a test can prove the adapter's
   * behavior on a Host whose storage layer predates the capability.
   */
  noTransaction?: boolean
}

class MemoryUnit implements KvUnit {
  private closed = false
  private writes = 0
  private failNextBatchAt: number | undefined

  constructor(
    private readonly medium: MemoryMedium,
    private readonly descriptor: KvUnitDescriptor,
    private readonly faults: MediumFaults,
  ) {}

  private assertOpen(): void {
    if (this.closed) throw new Error('closed')
  }

  private assertWritable(): void {
    this.assertOpen()
    this.writes += 1
    if (this.faults.failWrites !== undefined) throw this.faults.failWrites
    if (this.faults.failOnWriteNumber !== undefined && this.writes === this.faults.failOnWriteNumber) {
      throw this.faults.failOnWriteError ?? new Error(`injected write failure #${this.writes}`)
    }
  }

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    const tables: Record<string, Record<string, unknown>> = {}
    for (const table of this.descriptor.tables) {
      const stored = this.medium.tables[table] ?? {}
      const parsed: Record<string, unknown> = {}
      for (const [key, raw] of Object.entries(stored)) parsed[key] = JSON.parse(raw)
      tables[table] = parsed
    }
    return {
      tables,
      global: this.medium.global === null ? null : JSON.parse(this.medium.global),
    }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertWritable()
    const bucket = (this.medium.tables[table] ??= {})
    // Serialize on write: the medium stores opaque JSON, so a value mutated
    // after the call cannot retroactively change what was made durable.
    bucket[key] = JSON.stringify(value)
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertWritable()
    const bucket = this.medium.tables[table]
    if (bucket !== undefined) delete bucket[key]
  }

  async setGlobal(value: unknown): Promise<void> {
    this.assertWritable()
    this.medium.global = JSON.stringify(value)
  }

  /** Fail a future batch at a deterministic write index, before publication. */
  failNextBatch(writeNumber: number): void {
    this.failNextBatchAt = writeNumber
  }

  /**
   * Commit a batch atomically: staged into a copy first, so an injected
   * failure leaves the medium exactly as it was. This is what lets a test
   * distinguish a real transaction from a compensated write sequence.
   */
  async applyBatch(writes: readonly {
    kind: 'put' | 'delete' | 'global'
    table?: string
    key?: string
    value?: unknown
  }[]): Promise<void> {
    this.assertOpen()
    if (writes.length === 0) return
    const tables: Record<string, Record<string, string>> = {}
    for (const [table, bucket] of Object.entries(this.medium.tables)) tables[table] = { ...bucket }
    let global = this.medium.global
    for (const [index, write] of writes.entries()) {
      if (this.failNextBatchAt !== undefined && index + 1 === this.failNextBatchAt) {
        this.failNextBatchAt = undefined
        throw new Error(`injected atomic write failure #${String(index + 1)}`)
      }
      this.assertWritable()
      if (write.kind === 'global') {
        global = JSON.stringify(write.value)
        continue
      }
      const bucket = (tables[write.table as string] ??= {})
      if (write.kind === 'delete') delete bucket[write.key as string]
      else bucket[write.key as string] = JSON.stringify(write.value)
    }
    this.medium.tables = tables
    this.medium.global = global
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

/** One in-memory storage backend over a caller-owned medium. */
export class MemoryBackend {
  readonly kv: { open(descriptor: KvUnitDescriptor): Promise<KvUnit> }
  private readonly open = new Set<string>()
  private readonly units = new Map<string, KvUnit>()

  constructor(
    private readonly medium: MemoryMedium,
    private readonly faults: MediumFaults = {},
  ) {
    this.kv = {
      open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
        if (this.open.has(descriptor.name)) throw new Error('already-open')
        // Enforce the real version-stamp contract so version-mismatch
        // recovery can be tested honestly.
        if (this.medium.version === undefined) this.medium.version = descriptor.version
        else if (this.medium.version !== descriptor.version) throw new Error('version-mismatch')
        this.open.add(descriptor.name)
        const unit = new MemoryUnit(this.medium, descriptor, this.faults)
        if (this.faults.noTransaction === true) {
          // Omit the optional member exactly as such a backend would, rather
          // than leaving a method that reports being unavailable.
          const { applyBatch: _omitted, ...rest } = unit
          const withoutTransactions = Object.assign(Object.create(Object.getPrototypeOf(unit) as object), rest, {
            loadAll: () => unit.loadAll(),
            putRecord: (table: string, key: string, value: unknown) => unit.putRecord(table, key, value),
            deleteRecord: (table: string, key: string) => unit.deleteRecord(table, key),
            setGlobal: (value: unknown) => unit.setGlobal(value),
            close: () => unit.close(),
            applyBatch: undefined,
          }) as KvUnit
          this.units.set(descriptor.name, withoutTransactions)
          return withoutTransactions
        }
        this.units.set(descriptor.name, unit)
        return unit
      },
    }
  }

  unitFor(name: string): Promise<KvUnit | undefined> {
    return Promise.resolve(this.units.get(name))
  }

  failNextBatch(name: string, writeNumber: number): void {
    const unit = this.units.get(name) as (KvUnit & { failNextBatch?: (writeNumber: number) => void }) | undefined
    if (unit?.failNextBatch === undefined) throw new Error(`atomic batch injection unavailable for ${name}`)
    unit.failNextBatch(writeNumber)
  }

  async close(): Promise<void> {
    this.open.clear()
    this.units.clear()
  }
}

/** A live Pet domain bound to a caller-owned medium. */
export interface PetHarness {
  readonly repository: PetRepository
  readonly domain: Domain<typeof petDomainSpec>
  /** Underlying DSH context that publishes domain change events. */
  readonly ctx: Context
  readonly medium: MemoryMedium
  failNextAtomicBatch(writeNumber: number): void
  close(): Promise<void>
}

/**
 * Open the real `dsh-pet` domain over an in-memory medium.
 * @param medium - Medium to open; reuse one to simulate a Host restart.
 * @param faults - Optional injected medium faults.
 * @returns the live harness.
 */
export async function openPetHarness(
  medium: MemoryMedium = emptyMedium(),
  faults: MediumFaults = {},
): Promise<PetHarness> {
  const ctx = new Context()
  let backend: MemoryBackend
  await ctx.plugin(Storage)

  // Register the medium exactly the way a real backend plugin does: on the hub
  // registry AND as the `storage.backend.<name>` lifecycle service the domain
  // form injects, so activation cannot race backend registration.
  await ctx.plugin({
    name: 'memory-backend',
    inject: ['storage'],
    apply(backendCtx: Context) {
      backend = new MemoryBackend(medium, faults)
      backendCtx.effect(() => backendCtx.storage.backend.register('memory', backend))
      backendCtx.provide(storageBackendServiceKey('memory'), backend)
    },
  })

  await ctx.plugin(StorageDomain, { backend: 'memory' })

  const domain = await ctx.storage.domain.open(petDomainSpec)
  const unit = await backend!.unitFor(PET_DOMAIN_NAME)
  withAtomicWrites(domain as never, typeof unit?.applyBatch === 'function' ? unit : undefined)
  return {
    repository: new PetRepository(domain),
    domain,
    ctx,
    medium,
    failNextAtomicBatch: writeNumber => backend!.failNextBatch(PET_DOMAIN_NAME, writeNumber),
    close: async () => {
      await domain.close()
    },
  }
}

/** Deterministic clock-free id helper for readable test records. */
export function testTask(
  overrides: Partial<Parameters<PetRepository['createTask']>[0]> = {},
): Parameters<PetRepository['createTask']>[0] {
  const now = 1_700_000_000_000
  return {
    id: 'task-1',
    scopeKey: 'session:src-1',
    epoch: 1,
    sourceKind: 'session',
    sourceId: 'src-1',
    sourceAvailability: 'available',
    executorSessionId: 'exec-1',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    ...overrides,
  }
}

/** Build an Invocation payload without a queue position. */
export function testInvocation(
  overrides: Partial<Parameters<PetRepository['appendInvocation']>[0]> = {},
): Parameters<PetRepository['appendInvocation']>[0] {
  const now = 1_700_000_000_000
  return {
    id: 'inv-1',
    taskId: 'task-1',
    capabilityId: 'create-mr',
    skillName: 'create-mr',
    skillSourcePath: '/tmp/pet-test-skills/clean-worktree',
    skillSetGeneration: 1,
    snapshotId: 'snap-1',
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    ...overrides,
  }
}

/**
 * Register and enable a Skill so it projects as a capability.
 *
 * Capabilities are derived from registered Skills, so a test that wants one
 * registers a Skill instead of adding Pet-side code — mirroring how a real
 * deployment adds a capability.
 * @param harness - Open harness.
 * @param skillName - Skill (and capability) name.
 * @returns the source path the Skill was registered under.
 */
export async function installTestSkill(
  harness: PetHarness,
  skillName: string,
): Promise<string> {
  const sourcePath = `/tmp/pet-test-skills/${skillName}`
  await harness.repository.putSkillRevision({
    skillName,
    sourcePath,
    description: `${skillName} test skill`,
    provenance: { kind: 'local-link', sourcePath, installedAt: 1 },
    fileCount: 1,
    totalBytes: 32,
  })
  await harness.repository.putSkillSelection({
    skillName,
    enabled: true,
    showAsShortcut: true,
  })
  return sourcePath
}
