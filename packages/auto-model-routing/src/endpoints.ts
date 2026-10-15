import type { AgentRef, Router } from './router.js'
import type { RoutingState } from './state.js'
export async function endpoint(operation: 'state' | 'setMode', body: unknown, resolveAgent: (id: string) => Promise<AgentRef | undefined>, router: Router, state: RoutingState): Promise<Response> {
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid request' }, { status: 400 })
  const { sessionId, mode } = body as { sessionId?: unknown; mode?: unknown }
  if (typeof sessionId !== 'string' || !sessionId || (operation === 'setMode' && mode !== 'AUTO' && mode !== 'MANUAL')) return Response.json({ error: 'invalid request' }, { status: 400 })
  const agent = await resolveAgent(sessionId)
  if (!agent || agent.origin === 'subagent') return Response.json({ error: 'unknown ordinary session' }, { status: 404 })
  if (operation === 'setMode') router.setMode(agent, mode as 'AUTO' | 'MANUAL')
  return Response.json({ ...state.read(sessionId), ...router.status(agent) })
}
