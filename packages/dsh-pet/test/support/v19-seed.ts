/**
 * Raw v19-shaped Pet state for the v20 offline migration tests.
 *
 * The v20 domain no longer declares every table a v19 database carries
 * (`locus_indexes`, and the v19 `loci` row shape no longer parses), so these
 * helpers lay out the medium with Pet's backend and then write each physical
 * `u_dsh_pet_<table>` row directly with SQLite. Nothing is validated: a test
 * plants exactly the bytes a v19 (or older) Host would have left.
 *
 * Always point these at a temp directory; never at the live state file.
 */
import { DatabaseSync } from 'node:sqlite'
import { PET_DOMAIN_NAME } from '../../src/host/spec.js'
import { seedPetState } from './pet-sqlite.js'

/** `table -> key -> JSON value`; any table name, declared by v20 or not. */
export type V19Rows = Record<string, Record<string, unknown>>

/** Storage key separator of v19/v20 (`storage-key.ts`). */
export const SEP = '\u001f'

const physical = (table: string): string => `u_${PET_DOMAIN_NAME}_${table}`

/**
 * Materialize a Pet medium stamped `version` and plant raw rows into any
 * physical table (created when absent).
 */
export async function seedV19State(file: string, version: number, rows: V19Rows = {}): Promise<void> {
  await seedPetState(file, version, {})
  const db = new DatabaseSync(file)
  try {
    db.exec('BEGIN')
    for (const [table, records] of Object.entries(rows)) {
      db.exec(`CREATE TABLE IF NOT EXISTS "${physical(table)}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
      const put = db.prepare(`INSERT OR REPLACE INTO "${physical(table)}" (key, value) VALUES (?, ?)`)
      for (const [key, value] of Object.entries(records)) put.run(key, JSON.stringify(value))
    }
    db.exec('COMMIT')
  } finally {
    db.close()
  }
}

/** Drop a physical table, e.g. `locus_mains` for a v17 medium. */
export function dropTable(file: string, table: string): void {
  const db = new DatabaseSync(file)
  try { db.exec(`DROP TABLE IF EXISTS "${physical(table)}"`) } finally { db.close() }
}

/** Raw rows of one physical table, parsed, keyed by row key; `undefined` when the table is absent. */
export function readTable(file: string, table: string): Record<string, Record<string, unknown>> | undefined {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const exists = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(physical(table))
    if (exists === undefined) return undefined
    const out: Record<string, Record<string, unknown>> = {}
    for (const row of db.prepare(`SELECT key, value FROM "${physical(table)}" ORDER BY key`).all() as { key: string; value: string }[]) {
      out[row.key] = JSON.parse(row.value) as Record<string, unknown>
    }
    return out
  } finally {
    db.close()
  }
}

// -- builders -------------------------------------------------------------------

export interface V19MainInput {
  readonly id: string
  readonly work?: string
  readonly status?: 'active' | 'retired'
  readonly generation?: number
}

/** A `locus_mains` pairing as v18/v19 wrote it. */
export function v19Main(input: V19MainInput): Record<string, unknown> {
  return {
    locusMainSessionId: input.id,
    workSessionId: input.work ?? 'work-1',
    generation: input.generation ?? 1,
    status: input.status ?? 'active',
    spaceId: `space-${input.id}`,
    workspaceId: 'ws-pet',
    createdAt: 1,
    updatedAt: 1,
    ...(input.status === 'retired' ? { retiredAt: 1, retiredReason: 'replaced' } : {}),
  }
}

export type V19State = 'provisioning' | 'not-created' | 'active' | 'switching' | 'invalid' | 'stopped' | 'retired'

export interface V19RowInput {
  readonly id: string
  readonly chatId: string
  readonly threadId?: string
  /** The row's M (`parentSessionId`). */
  readonly main?: string
  readonly generation?: number
  readonly state?: V19State
  readonly source?: 'auto' | 'inherited' | 'explicit' | 'qa-created'
  /** Defaults to `child-<id>` for an `active` row; `null` omits it. */
  readonly child?: string | null
  readonly reserved?: string
  readonly parentLocusId?: string
  readonly write?: boolean
  readonly shell?: boolean
  readonly revision?: number
  readonly createdAt?: number
  readonly updatedAt?: number
  readonly retiredAt?: number
  readonly stoppedAt?: number
  readonly invalidReason?: string
  readonly replacesLocusId?: string
  readonly workspaceId?: string
}

/** A real v19 `loci` row (the shape `buildLocusRecord` produced). */
export function v19Row(input: V19RowInput): Record<string, unknown> {
  const state = input.state ?? 'active'
  const child = input.child === null
    ? undefined
    : input.child ?? (state === 'active' ? `child-${input.id}` : undefined)
  const updatedAt = input.updatedAt ?? 10
  return {
    id: input.id,
    generation: input.generation ?? 1,
    endpoint: input.threadId === undefined ? { chatId: input.chatId } : { chatId: input.chatId, threadId: input.threadId },
    parentSessionId: input.main ?? 'main-1',
    ...(child === undefined ? {} : { childSessionId: child }),
    ...(input.reserved === undefined ? {} : { reservedChildSessionId: input.reserved }),
    ...(child !== undefined && state === 'active' ? { childComposition: 'tier3' } : {}),
    toolTier: input.shell === true
      ? { desired: 'shell', effective: 'shell', verifiedAt: 5, grantedBy: 'owner-1' }
      : { desired: 'safe', effective: 'safe' },
    workspaceId: input.workspaceId ?? 'ws-1',
    ...(input.threadId === undefined
      ? {}
      : { parentLocusId: input.parentLocusId ?? `g-${input.chatId}` }),
    source: input.source ?? (input.threadId === undefined ? 'auto' : 'inherited'),
    state,
    permission: input.write === true
      ? { desired: 'write', effective: 'write', verifiedAt: 6, grantedBy: 'owner-1' }
      : { desired: 'read', effective: 'read' },
    ...(input.revision === undefined ? {} : { revision: input.revision }),
    busy: false,
    createdAt: input.createdAt ?? 1,
    updatedAt,
    ...(input.retiredAt === undefined ? {} : { retiredAt: input.retiredAt }),
    ...(input.stoppedAt === undefined ? {} : { stoppedAt: input.stoppedAt }),
    ...(input.invalidReason === undefined
      ? state === 'invalid' ? { invalidReason: 'child gone' } : {}
      : { invalidReason: input.invalidReason }),
    ...(input.replacesLocusId === undefined ? {} : { replacesLocusId: input.replacesLocusId }),
  }
}

/**
 * Several generations of one entry, oldest first: every earlier generation
 * is `retired`, the last one takes `latest`. Ids are `<id>-g<n>`.
 */
export function v19Generations(
  base: Omit<V19RowInput, 'id' | 'generation'> & { readonly id: string },
  count: number,
  latest: Partial<V19RowInput> = {},
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (let generation = 1; generation <= count; generation += 1) {
    const id = `${base.id}-g${generation}`
    const last = generation === count
    out[id] = v19Row({
      ...base,
      id,
      generation,
      ...(last
        ? latest
        : { state: 'retired', child: `child-${id}`, retiredAt: generation * 10, updatedAt: generation * 10 }),
      ...(generation > 1 ? { replacesLocusId: `${base.id}-g${generation - 1}` } : {}),
    })
  }
  return out
}

/** A terminal Delivery row as v19 persisted it (with `generation` and `childSessionId`). */
export function v19Delivery(
  id: string,
  locusId: string,
  child: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    deliveryId: id,
    messageId: `om-${id}`,
    endpoint: { chatId: 'oc_d' },
    locusId,
    generation: 1,
    childSessionId: child,
    senderOpenId: 'ou_sender',
    sequence: 1,
    status: 'replied',
    acceptedAt: 1,
    finishOutcome: 'reply',
    outboundResult: 'success',
    finishedAt: 2,
    feedbackTarget: { chatId: 'oc_d', messageId: `om-${id}` },
    ...extra,
  }
}

/** A v19 `default-qa` index row: `{key: 'default-qa:<M>', locusIds: [<old locusId>]}`. */
export function v19DefaultQa(main: string, locusId: string, key = `default-qa:${main}`): Record<string, unknown> {
  return { kind: 'default-qa', key, locusIds: [locusId], updatedAt: 1 }
}
