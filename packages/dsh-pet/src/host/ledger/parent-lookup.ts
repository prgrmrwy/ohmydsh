/**
 * Caller-bound READ-ONLY parent session lookup — the "只读父会话查阅" tool's
 * execution logic (registration/scoping is wired separately, see tools.ts's
 * existing pattern for `pet_context`/`pet_locus_finish`).
 *
 * Spec: `pet-locus-intent-triage`, requirement "caller-bound 只读父会话查阅不
 * 唤醒主会话". Design D3: this MUST be a pure data read — it directly reads
 * already-persisted events, and MUST NOT re-enter the parent session, wake
 * it, deliver it a message, occupy its run slot, or consume its turn.
 *
 * ⚠️ THE DEFINING CONSTRAINT (task 4.2's test boundary): this module's only
 * dependency is `inspect(sessionId): Promise<{ events, meta }>` — the exact
 * same cold-read seam `locus/management.ts#createLocusSessionDescriber`
 * already uses. There is NO dependency here on `followup`, `queuePrompt`,
 * `resolveAgent`, `sendMessage`, or anything that could deliver work to a
 * live Agent. This is a structural fact enforced by this file's own import
 * list, not merely a runtime behavior to hope for.
 */
import type { LedgerCaller } from './caller.js'

/** The narrow read-only capability this tool needs — nothing else. */
export interface ParentLookupDeps {
  /**
   * Cold-readable session inspection. Same seam as
   * `locus/management.ts#LocusSessionDescriberDeps.inspect` — resolves for a
   * session whose durable log exists (loaded or not), rejects when it cannot
   * be read. Absent when the Host has no such capability.
   */
  readonly inspect: ((sessionId: string) => Promise<{
    readonly events?: readonly unknown[]
  }>) | undefined
}

export type ParentLookupResult =
  | { readonly ok: true; readonly transcript: readonly ParentTranscriptLine[] }
  | { readonly ok: false; readonly reason: 'unavailable' | 'empty' }

/** One extracted line of the parent's already-persisted, human/model-readable history. */
export interface ParentTranscriptLine {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

const MAX_TRANSCRIPT_LINES = 200
const MAX_LINE_LENGTH = 4_000

/**
 * Extract plain-text lines from `content` without assuming the full
 * `@deepseek-ai/dsh-llm` message-part union — this module deliberately does
 * not add that type dependency (matching the "narrow read" precedent
 * established in design.md's task-1.1 finding: read only what this change
 * actually needs, not the full official shape). Any part this cannot safely
 * read as text is skipped rather than guessed at.
 */
function extractText(content: unknown): string | undefined {
  if (typeof content === 'string') return content.slice(0, MAX_LINE_LENGTH)
  if (!Array.isArray(content)) return undefined
  const pieces: string[] = []
  for (const part of content) {
    if (part !== null && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      pieces.push((part as { text: string }).text)
    }
  }
  if (pieces.length === 0) return undefined
  return pieces.join('\n').slice(0, MAX_LINE_LENGTH)
}

/**
 * Fold raw persisted events into a bounded, model-readable transcript.
 *
 * Only `user/message` and `assistant/message` events carry text; every other
 * event type (`turn/start`, `tool/call`, `tool/result`, `request/header`, …)
 * is control/bookkeeping data this tool has no business surfacing — surfacing
 * it would leak tool-call arguments/results the requester never asked for and
 * inflate what "对话事实" means well past its intended scope.
 */
function foldTranscript(events: readonly unknown[]): readonly ParentTranscriptLine[] {
  const lines: ParentTranscriptLine[] = []
  for (const raw of events) {
    if (raw === null || typeof raw !== 'object') continue
    const event = raw as { type?: unknown; data?: unknown }
    if (event.type === 'user/message') {
      const text = extractText((event.data as { content?: unknown } | undefined)?.content)
      if (text !== undefined) lines.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      const message = (event.data as { message?: unknown } | undefined)?.message
      const text = extractText((message as { content?: unknown } | undefined)?.content)
      if (text !== undefined) lines.push({ role: 'assistant', text })
    }
  }
  // Keep only the most recent lines: this is a read for judging INTENT and
  // recent context, not a full-history dump — an unbounded transcript would
  // reintroduce the "37 steps / 40 tool calls" over-retrieval risk B037
  // documented against unrelated-history access.
  return Object.freeze(lines.slice(-MAX_TRANSCRIPT_LINES))
}

/**
 * Look up the caller-bound main session's already-persisted transcript.
 *
 * This function takes NO target parameter beyond the already-resolved
 * `LedgerCaller` (produced by `resolveLedgerCaller` from the ACTUAL executing
 * session, never a model-supplied argument) — matching spec's "工具 MUST NOT
 * 接受任何会话、locus 或目标 selector".
 */
export async function lookupParentTranscript(
  caller: LedgerCaller,
  deps: ParentLookupDeps,
): Promise<ParentLookupResult> {
  if (typeof deps.inspect !== 'function') return { ok: false, reason: 'unavailable' }
  let inspection: { readonly events?: readonly unknown[] } | undefined
  try {
    inspection = await deps.inspect(caller.parentSessionId)
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  const events = inspection?.events
  if (events === undefined) return { ok: false, reason: 'unavailable' }
  const transcript = foldTranscript(events)
  if (transcript.length === 0) return { ok: false, reason: 'empty' }
  return { ok: true, transcript }
}
