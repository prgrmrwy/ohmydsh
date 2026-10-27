import { allocationFeedback, type FeedbackBook } from './feedback.js'
import type { RoutingState } from './state.js'

/** Identity of a live session as the endpoints need it. */
export interface AgentRef { id: string; origin?: string }
type Resolve = (id: string) => Promise<AgentRef | undefined>
const invalid = () => Response.json({ error: 'invalid request' }, { status: 400 })
const unknown = () => Response.json({ error: 'unknown ordinary session' }, { status: 404 })

/** Validates the session and applies `setMode`; the caller adds the policy host's view to the response. */
export async function endpoint(operation: 'state' | 'setMode', body: unknown, resolveAgent: Resolve, state: RoutingState): Promise<Response> {
  if (typeof body !== 'object' || body === null) return invalid()
  const { sessionId, mode } = body as { sessionId?: unknown; mode?: unknown }
  if (typeof sessionId !== 'string' || !sessionId || (operation === 'setMode' && mode !== 'AUTO' && mode !== 'MANUAL')) return invalid()
  const agent = await resolveAgent(sessionId)
  if (!agent || agent.origin === 'subagent') return unknown()
  if (operation === 'setMode') state.setMode(sessionId, mode as 'AUTO' | 'MANUAL')
  return Response.json(state.read(sessionId))
}

export async function observeEndpoint(body: unknown, resolveAgent: Resolve, book: FeedbackBook, warn: () => void): Promise<Response> {
  if (typeof body !== 'object' || body === null) return invalid()
  const { sessionId, messageId } = body as { sessionId?: unknown; messageId?: unknown }
  if (typeof sessionId !== 'string' || !sessionId || typeof messageId !== 'string' || !messageId) return invalid()
  const agent = await resolveAgent(sessionId)
  if (!agent || agent.origin === 'subagent') return unknown()
  const binding = book.lookup(sessionId, messageId)
  if (binding) try { book.fact(sessionId, binding.decisionId, 'exposed') } catch { warn() }
  return Response.json({})
}

/** Query (no `feedback`) or change the allocation feedback of a reply. Unknown keys (e.g. a retired `label`) are rejected. */
export async function labelEndpoint(body: unknown, resolveAgent: Resolve, book: FeedbackBook): Promise<Response> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid()
  if (Object.keys(body).some(key => !['sessionId', 'messageId', 'feedback'].includes(key))) return invalid()
  const { sessionId, messageId } = body as { sessionId?: unknown; messageId?: unknown }
  if (typeof sessionId !== 'string' || !sessionId || typeof messageId !== 'string') return invalid()
  const agent = await resolveAgent(sessionId)
  if (!agent || agent.origin === 'subagent') return unknown()
  const hasFeedback = Object.hasOwn(body, 'feedback')
  const feedback = (body as { feedback?: unknown }).feedback
  if (hasFeedback && feedback !== null && !allocationFeedback.includes(feedback as typeof allocationFeedback[number])) return Response.json({ error: 'invalid feedback' }, { status: 400 })
  if (!book.lookup(sessionId, messageId)) return hasFeedback ? Response.json({ error: 'no applied decision' }, { status: 404 }) : Response.json({})
  if (hasFeedback) {
    try { book.set(sessionId, messageId, feedback as typeof allocationFeedback[number] | null) }
    catch { return Response.json({ error: 'could not record feedback' }, { status: 500 }) }
  }
  return Response.json(book.view(sessionId, messageId))
}
