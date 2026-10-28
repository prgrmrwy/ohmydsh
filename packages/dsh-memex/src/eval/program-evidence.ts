import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { RoundItem } from './round.js'
import type { Verdict } from './scoring.js'
import { observeWriteback, type WritebackClass, type WritebackEvent } from './writeback.js'
import { readFrozenInput } from './freeze.js'
import { join } from 'node:path'
import { lstatSync } from 'node:fs'
export interface ProgramEvidence {
  retrieval: { source: string; tool: string; text: string }[]
  writes: { source: string; tool: string; at: number; success: boolean; targetCorrect: boolean; slug: string; content: string }[]
  writeback: { class: WritebackClass; failedWrites: number }
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return {} } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export interface FrozenProgramEvidence {
  retrieval: ProgramEvidence['retrieval']; writes: ProgramEvidence['writes'];
  sessions: { session: string; writeback: ProgramEvidence['writeback'] }[]
}
export function loadProgramEvidence(directory: string): FrozenProgramEvidence | undefined {
  const path = join(directory, 'program-evidence')
  try { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid program evidence directory') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  const value = readFrozenInput(path) as FrozenProgramEvidence
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 3 || !['retrieval', 'writes', 'sessions'].every(key => Object.hasOwn(value, key))
    || !Array.isArray(value.retrieval) || !Array.isArray(value.writes) || !Array.isArray(value.sessions)) throw new Error('Invalid program evidence')
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  if (value.retrieval.some(item => !item || Object.keys(item).length !== 3 || !text(item.source) || !text(item.tool) || typeof item.text !== 'string')
    || value.writes.some(item => !item || Object.keys(item).length !== 7 || !text(item.source) || !text(item.tool) || !Number.isFinite(item.at) || item.at < 0 || typeof item.success !== 'boolean' || typeof item.targetCorrect !== 'boolean' || typeof item.slug !== 'string' || typeof item.content !== 'string')
    || value.sessions.some(item => !item || Object.keys(item).length !== 2 || !text(item.session) || !item.writeback || Object.keys(item.writeback).length !== 2
      || !['proactive', 'requested', 'reminded', 'not-written', 'unknown'].includes(item.writeback.class) || !Number.isSafeInteger(item.writeback.failedWrites) || item.writeback.failedWrites < 0)) throw new Error('Invalid program evidence')
  return value
}
export function fixedProgramOutcome(item: RoundItem, observed?: FrozenProgramEvidence): { R: Verdict[]; W: Verdict[] } {
  if (!observed) return { R: [], W: [] }
  // Fixed literal selftest protocol, not semantic retrieval quality or arbitrary business facts.
  const pattern = item.question === 'know' ? /(?:permits four retries\b|retryLimit\s*(?:is|[:=])\s*4(?!\d|\.\d))/i : /(?:\b15-second lease\b|leaseSeconds\s*(?:is|[:=])\s*45(?!\d|\.\d))/i
  const R: Verdict[] = item.condition === 'nomem' ? [] : [observed.retrieval.some(value => pattern.test(value.text)) ? 'yes' : 'no']
  const successful = observed.writes.filter(value => value.success)
  const W: Verdict[] = !item.writebackApplicable ? [] : !successful.length ? ['no']
    : successful.some(value => !value.targetCorrect) ? ['no'] : ['yes', 'unknown']
  return { R, W }
}

/** Only successful, paired Memex outputs count as delivery; generic file reads are not retrieval. */
export function programEvidence(id: string, events: readonly SessionEvent[], inherited: number, own: { scope: string; home: string; cwd: string }, naturalPrompts: readonly string[] = []): ProgramEvidence {
  if (!Number.isSafeInteger(inherited) || inherited < 0 || inherited > events.length) throw new Error('Invalid inherited prefix')
  const retrieval: ProgramEvidence['retrieval'] = [], writes: ProgramEvidence['writes'] = []
  const timing: WritebackEvent[] = []
  const interventions: number[] = []
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>()
  for (const event of events) {
    if (event.seq < inherited) continue
    if (event.type === 'user/message') {
      const source = event.data.source
      if (source.kind === 'plugin:dsh-memex' && 'summary' in source && source.summary === 'Memex write reminder') timing.push({ kind: 'reminder', at: event.time })
      if (source.kind !== 'plugin:dsh-memex') {
        const content = event.data.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
        // Arbitrary user/agent input has no trustworthy mechanical write-intent tag.
        // Do not classify natural language or transfer intent from another session.
        if (!naturalPrompts.includes(content)) interventions.push(event.time)
      }
    }
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) if (block.type === 'tool-call') {
        if (calls.has(block.id)) throw new Error('Duplicate tool identity in program evidence')
        calls.set(block.id, { name: block.name, args: object(block.arguments) })
      }
    }
    if (event.type !== 'tool/result') continue
    const call = calls.get(event.data.message.toolCallId)
    if (!call) continue
    calls.delete(event.data.message.toolCallId)
    const text = event.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
    const result = object(text), current = object(result.current), target = object(result.target)
    const source = `${id}:${event.seq}`
    const ownTarget = (route: Record<string, unknown>) => route.scope === own.scope && route.home === own.home
    if (!event.data.message.isError && ['memex_recall', 'memex_search', 'memex_read'].includes(call.name)) {
      if (call.name === 'memex_search' && Array.isArray(result.hits)) {
        for (const raw of result.hits) {
          const hit = object(raw)
          if (hit.scope === own.scope && typeof hit.summary === 'string') retrieval.push({ source, tool: call.name, text: hit.summary })
        }
      } else if (ownTarget(call.name === 'memex_read' ? target : current) && typeof result.content === 'string') {
        retrieval.push({ source, tool: call.name, text: result.content })
      }
    }
    if (['memex_retro', 'memex_write', 'memex_archive'].includes(call.name)) {
      const success = !event.data.message.isError && (call.name === 'memex_archive' ? result.archived === true : result.written === true)
      writes.push({ source, tool: call.name, at: event.time, success, targetCorrect: ownTarget(current) && !(Array.isArray(result.additional) && result.additional.some(value => object(value).written === true && object(value).scope !== own.scope)),
        slug: typeof call.args.slug === 'string' ? call.args.slug : '',
        content: typeof call.args.body === 'string' ? call.args.body : typeof call.args.content === 'string' ? call.args.content : '' })
      timing.push({ kind: 'write', at: event.time, success })
    }
  }
  const writeback = observeWriteback(timing)
  const firstWrite = Math.min(...writes.filter(value => value.success).map(value => value.at))
  if (Number.isFinite(firstWrite) && interventions.some(at => at <= firstWrite)) writeback.class = 'unknown'
  return { retrieval, writes, writeback }
}
