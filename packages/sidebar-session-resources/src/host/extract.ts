/**
 * Host-side full-log extraction: fold a session's complete event log into
 * (a) the deduped link set and (b) the produced-file set through the same
 * render-intent presenter seam the official deliverables use. Pure and
 * unit-tested; the `presentCall` bridge is injected by the RPC handler.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  classifyUrl,
  DEFAULT_LINK_RULES,
  extractUrls,
  linkTitle,
  type LinkEntry,
  type LinkRules,
  type LinkRole,
} from '../shared/links.js'
import type { PresentCall, ProducedFile, SessionExtraction } from '../shared/produced.js'
import { mutationPathOfCall } from '../shared/mutations.js'

/** Is this render intent a mutation whose locations count as produced files? */
function isMutation(view: NonNullable<ReturnType<PresentCall>>): boolean {
  if (view.card === 'diff') return true
  return view.card === 'generic' && view.kind === 'edit'
}

/** The paths a mutation view declares (diffs are the safest fallback). */
function mutationPaths(view: NonNullable<ReturnType<PresentCall>>): string[] {
  if (view.card === 'diff') {
    const fromLocations = view.locations?.map((l) => l.path) ?? []
    const fromDiffs = view.diffs?.map((d) => d.path) ?? []
    return [...new Set([...fromLocations, ...fromDiffs])]
  }
  return [...new Set(view.locations?.map((l) => l.path) ?? [])]
}

/**
 * Whether a persisted tool result reports failure, on either runtime shape:
 * DSH 0.2.0 records a tool-role message with a top-level `isError`; 0.1.5 and
 * migrated history kept it on the first `tool-result` content block.
 */
function toolResultFailed(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false
  const record = message as { isError?: unknown; content?: unknown }
  if (record.isError === true) return true
  const first = Array.isArray(record.content) ? record.content[0] as { isError?: unknown } | undefined : undefined
  return first?.isError === true
}

/**
 * Fold a session's complete event log. Links come from user/assistant text
 * blocks; produced files come from tool/call render intents. Failed results
 * are removed (provisional entries withdrawn via the failed-call set), and
 * a file written then edited later stays one entry (first-seen kept).
 * Presenter throws soft-fall to no view (the generic-card default).
 */
export function extractSession(events: readonly SessionEvent[], presentCall: PresentCall, rules: LinkRules = DEFAULT_LINK_RULES): SessionExtraction {
  // A persisted call without a successful result is not yet an output file.
  const completedCalls = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const callId = event.data.message?.source?.callId
    if (typeof callId !== 'string') continue
    if (event.data.error !== undefined || toolResultFailed(event.data.message)) completedCalls.delete(callId)
    else completedCalls.add(callId)
  }

  const byUrl = new Map<string, LinkEntry>()
  const byPath = new Map<string, ProducedFile>()
  let maxSeq = -1

  const collectUrl = (seq: number, time: number, role: LinkRole, text: string): void => {
    for (const url of extractUrls(text)) {
      const prev = byUrl.get(url)
      byUrl.set(url, prev
        ? { ...prev, time, seq, role, count: prev.count + 1 }
        : { url, category: classifyUrl(url, rules), time, seq, role, title: linkTitle(url), count: 1 })
    }
  }

  for (const event of events) {
    if (event.seq > maxSeq) maxSeq = event.seq
    if (event.type === 'user/message') {
      for (const block of event.data.content) {
        if (block.type === 'text') collectUrl(event.seq, event.time, 'user', block.text)
      }
      continue
    }
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        // Visible text only — reasoning and tool payloads are never collected.
        if (block.type === 'text') collectUrl(event.seq, event.time, 'assistant', block.text)
      }
      continue
    }
    if (event.type === 'tool/call') {
      const { callId, name, arguments: rawArgs } = event.data
      if (!completedCalls.has(callId)) continue
      let view: ReturnType<PresentCall>
      try {
        view = presentCall(name, rawArgs)
      } catch {
        view = undefined
      }
      // Agent-scoped tools may have no Host presenter; keep the existing first-party vocabulary.
      const fallback = view === undefined ? mutationPathOfCall(name, rawArgs) : null
      const paths = view !== undefined && isMutation(view) ? mutationPaths(view) : fallback === null ? [] : [fallback]
      for (const path of paths) {
        if (!byPath.has(path)) byPath.set(path, { path, time: event.time, seq: event.seq })
      }
      continue
    }
    // Everything else (tool/result, turn markers, chunks…) feeds nothing here.
  }

  return { entries: [...byUrl.values()], produced: [...byPath.values()], maxSeq }
}