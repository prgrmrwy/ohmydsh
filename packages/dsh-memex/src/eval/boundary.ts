import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isAbsolute, join, normalize, sep } from 'node:path'

export interface BoundaryHit { seq: number; tool: string; path: string; kind: 'real-library' | 'suite-answer' | 'other-condition' }

/** Paths a value tree carries; only strings that are absolute paths count. */
function paths(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') { if (isAbsolute(value)) out.push(value) }
  else if (Array.isArray(value)) for (const item of value) paths(item, out)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) paths(item, out)
  return out
}
const within = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/**
 * After-the-fact detection of known out-of-bounds access in successful tool calls.
 * It cannot see access hidden in shell strings or relative paths; it never claims to.
 */
export function detectBoundaryAccess(events: readonly SessionEvent[], scope: { home: string; own: { cwd: string; home: string } }): BoundaryHit[] {
  const calls = new Map<string, { tool: string; arguments: unknown }>()
  for (const event of events) if (event.type === 'assistant/message') {
    for (const block of event.data.message.content) if (block.type === 'tool-call') {
      let parsed: unknown = block.arguments
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { /* keep raw string */ } }
      calls.set(block.id, { tool: block.name, arguments: parsed })
    }
  }
  const ownRun = normalize(join(scope.own.cwd, '..'))
  const libraries = normalize(join(scope.home, '.dsh-memex'))
  const runs = normalize(join(scope.home, '.dsh-memex-eval-runs'))
  const answers = normalize(join(scope.home, '.dsh-memex-eval'))
  const hits: BoundaryHit[] = []
  for (const event of events) {
    if (event.type !== 'tool/result' || event.data.message.isError) continue
    const call = calls.get(event.data.message.toolCallId)
    if (!call) continue
    for (const raw of paths(call.arguments)) {
      const path = normalize(raw)
      if (within(path, normalize(scope.own.home)) || within(path, ownRun)) continue
      const kind = within(path, answers) ? 'suite-answer' : within(path, runs) ? 'other-condition' : within(path, libraries) ? 'real-library' : undefined
      if (kind) hits.push({ seq: event.seq, tool: call.tool, path: raw, kind })
    }
  }
  return hits
}
