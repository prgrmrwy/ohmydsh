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
import { petDomainSpec } from '../src/host/spec.js'

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
}

class MemoryUnit implements KvUnit {
  private closed = false

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
    if (this.faults.failWrites !== undefined) throw this.faults.failWrites
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

  async close(): Promise<void> {
    this.closed = true
  }
}

/** One in-memory storage backend over a caller-owned medium. */
export class MemoryBackend {
  readonly kv: { open(descriptor: KvUnitDescriptor): Promise<KvUnit> }
  private readonly open = new Set<string>()

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
        return new MemoryUnit(this.medium, descriptor, this.faults)
      },
    }
  }

  async close(): Promise<void> {
    this.open.clear()
  }
}

/** A live Pet domain bound to a caller-owned medium. */
export interface PetHarness {
  readonly repository: PetRepository
  readonly domain: Domain<typeof petDomainSpec>
  readonly medium: MemoryMedium
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
  await ctx.plugin(Storage)

  // Register the medium exactly the way a real backend plugin does: on the hub
  // registry AND as the `storage.backend.<name>` lifecycle service the domain
  // form injects, so activation cannot race backend registration.
  await ctx.plugin({
    name: 'memory-backend',
    inject: ['storage'],
    apply(backendCtx: Context) {
      const backend = new MemoryBackend(medium, faults)
      backendCtx.effect(() => backendCtx.storage.backend.register('memory', backend))
      backendCtx.provide(storageBackendServiceKey('memory'), backend)
    },
  })

  await ctx.plugin(StorageDomain, { backend: 'memory' })

  const domain = await ctx.storage.domain.open(petDomainSpec)
  return {
    repository: new PetRepository(domain),
    domain,
    medium,
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
