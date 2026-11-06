/**
 * `validateLocusSetForStorage` of the v20 locus contract (design D1, D12).
 *
 * Zod and relative imports only: the offline migration CLI imports this file
 * from an installed package, where no `@deepseek-ai/*` runtime is available.
 * Keep it free of Host imports.
 */
import { petLocusRowV20 } from './contract-v20.js'
import { STORAGE_KEY_SEPARATOR } from './storage-key.js'
import type { LocusRowV20, LocusSetViolationV20, LocusTopicRowV20 } from './contract-v20.js'

/** A row is a topic row exactly when its endpoint carries a `threadId`. */
export function isTopicRowV20(row: LocusRowV20): row is LocusTopicRowV20 {
  return 'threadId' in row.endpoint
}

/**
 * The `loci` table key of an entry: `chatId` for a group row, `chatId` + the
 * storage separator + `threadId` for a topic row. Must match
 * {@link petLocusRowV20}'s `endpoint`.
 */
export function endpointKeyV20(endpoint: { readonly chatId: string; readonly threadId?: string | undefined }): string {
  return endpoint.threadId === undefined
    ? endpoint.chatId
    : `${endpoint.chatId}${STORAGE_KEY_SEPARATOR}${endpoint.threadId}`
}

/**
 * Validate a whole `loci` table against the v20 set invariants. `rows` maps
 * each table key to its raw value; `mainIds` lists every `locus_mains` key,
 * active and retired. Returns every violation; an empty array means valid.
 */
export function validateLocusSetForStorage(
  rows: ReadonlyMap<string, unknown>,
  mainIds: ReadonlySet<string>,
): LocusSetViolationV20[] {
  const violations: LocusSetViolationV20[] = []
  const valid = new Map<string, ReturnType<typeof petLocusRowV20.parse>>()

  for (const [key, raw] of rows) {
    const parsed = petLocusRowV20.safeParse(raw)
    if (!parsed.success) {
      violations.push({ code: 'ROW_INVALID', key, message: parsed.error.issues.map(issue => issue.message).join('; ') })
      continue
    }
    const row = parsed.data
    if (endpointKeyV20(row.endpoint) !== key) {
      violations.push({ code: 'KEY_MISMATCH', key, message: 'row endpoint does not match its table key' })
      continue
    }
    valid.set(key, row)
  }

  const seenLocusIds = new Map<string, string>()
  const seenSessionIds = new Map<string, string>()
  const qaByMain = new Map<string, string[]>()

  for (const [key, row] of valid) {
    const firstLocus = seenLocusIds.get(row.locusId)
    if (firstLocus !== undefined) {
      violations.push({ code: 'DUPLICATE_LOCUS_ID', key, message: `locusId ${row.locusId} also on ${firstLocus}` })
    } else {
      seenLocusIds.set(row.locusId, key)
    }

    const firstSession = seenSessionIds.get(row.sessionId)
    if (firstSession !== undefined) {
      violations.push({ code: 'DUPLICATE_SESSION_ID', key, message: `sessionId ${row.sessionId} also on ${firstSession}` })
    } else {
      seenSessionIds.set(row.sessionId, key)
    }

    if (isTopicRowV20(row)) {
      const group = valid.get(row.endpoint.chatId)
      if (group === undefined || isTopicRowV20(group)) {
        violations.push({ code: 'TOPIC_WITHOUT_GROUP', key, message: `topic has no group row for chat ${row.endpoint.chatId}` })
      }
      continue
    }

    if (!mainIds.has(row.locusMainSessionId)) {
      violations.push({ code: 'GROUP_MAIN_UNPAIRED', key, message: `group M ${row.locusMainSessionId} has no locus_mains pairing` })
    }
    if (row.defaultQa === true) {
      const list = qaByMain.get(row.locusMainSessionId) ?? []
      list.push(key)
      qaByMain.set(row.locusMainSessionId, list)
    }
  }

  for (const [main, keys] of qaByMain) {
    if (keys.length > 1) {
      // One violation per offending row, so the diagnostic names every key.
      for (const key of keys) {
        violations.push({ code: 'MULTIPLE_DEFAULT_QA', key, message: `M ${main} has ${keys.length} default Q&A groups` })
      }
    }
  }
  return violations
}
