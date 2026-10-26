import { allocationFeedback, type FeedbackBook } from './feedback.js'
import type { AgentRef, Router } from './router.js'
import type { RoutingState } from './state.js'
import { tiers, type Tier } from './effort.js'
import type { TurnRecord } from './judgements.js'
export async function endpoint(operation: 'state' | 'setMode', body: unknown, resolveAgent: (id: string) => Promise<AgentRef | undefined>, router: Router, state: RoutingState, toastOn: () => boolean = () => false): Promise<Response> {
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid request' }, { status: 400 })
  const { sessionId, mode } = body as { sessionId?: unknown; mode?: unknown }
  if (typeof sessionId !== 'string' || !sessionId || (operation === 'setMode' && mode !== 'AUTO' && mode !== 'MANUAL')) return Response.json({ error: 'invalid request' }, { status: 400 })
  const agent = await resolveAgent(sessionId)
  if (!agent || agent.origin === 'subagent') return Response.json({ error: 'unknown ordinary session' }, { status: 404 })
  if (operation === 'setMode') router.setMode(agent, mode as 'AUTO' | 'MANUAL')
  // The latest decision is always returned (the hover panel shows it); the switch only asks for the pop-up hint.
  const decision = router.judgement(sessionId)
  return Response.json({ ...state.read(sessionId), ...router.status(agent), ...(decision ? { decision } : {}), ...(toastOn() ? { decisionToast: true } : {}) })
}

export async function observeEndpoint(body:unknown,resolveAgent:(id:string)=>Promise<AgentRef|undefined>,book:FeedbackBook,warn:()=>void):Promise<Response>{
  if(typeof body!=='object'||body===null)return Response.json({error:'invalid request'},{status:400})
  const {sessionId,messageId}=body as {sessionId?:unknown;messageId?:unknown}
  if(typeof sessionId!=='string'||!sessionId||typeof messageId!=='string'||!messageId)return Response.json({error:'invalid request'},{status:400})
  const agent=await resolveAgent(sessionId)
  if(!agent||agent.origin==='subagent')return Response.json({error:'unknown ordinary session'},{status:404})
  const binding=book.lookup(sessionId,messageId)
  if(binding)try{book.fact(sessionId,binding.decisionId,'exposed')}catch{warn()}
  return Response.json({})
}

export interface LabelBook {
  lookup(sessionId: string, messageId: string): TurnRecord | undefined
  label(sessionId: string, turn: number, label: Tier): void
}
/** Query (no `label`) or label the judged turn a reply belongs to (design D13). */
export async function labelEndpoint(body: unknown, resolveAgent: (id: string) => Promise<AgentRef | undefined>, book: LabelBook, feedbackBook?: FeedbackBook): Promise<Response> {
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid request' }, { status: 400 })
  const { sessionId, messageId, label } = body as { sessionId?: unknown; messageId?: unknown; label?: unknown }
  if (typeof sessionId !== 'string' || !sessionId || typeof messageId !== 'string' || (label !== undefined && !tiers.includes(label as Tier))) return Response.json({ error: 'invalid request' }, { status: 400 })
  const agent = await resolveAgent(sessionId)
  if (!agent || agent.origin === 'subagent') return Response.json({ error: 'unknown ordinary session' }, { status: 404 })
  const hasFeedback = Object.hasOwn(body, 'feedback')
  const feedback = (body as { feedback?: unknown }).feedback
  if (hasFeedback && (label !== undefined || (feedback !== null && !allocationFeedback.includes(feedback as typeof allocationFeedback[number])))) return Response.json({ error: 'invalid feedback' }, { status: 400 })
  const allocation = feedbackBook?.lookup(sessionId, messageId)
  if (allocation) {
    if (label !== undefined) return Response.json({ error: 'use allocation feedback' }, { status: 400 })
    if (hasFeedback) {
      try { feedbackBook!.set(sessionId, messageId, feedback as typeof allocationFeedback[number] | null) }
      catch { return Response.json({ error: 'could not record feedback' }, { status: 500 }) }
    }
    return Response.json({ policy: 'policy-v2', ...feedbackBook!.lookup(sessionId, messageId) })
  }
  if (hasFeedback) return Response.json({ error: 'no applied decision' }, { status: 404 })
  const record = book.lookup(sessionId, messageId)
  if (!record) return Response.json({})
  const { turn, ...view } = record
  if (label !== undefined) {
    try { book.label(sessionId, turn, label as Tier) }
    catch { return Response.json({ error: 'could not record the label' }, { status: 500 }) }
    view.label = label as Tier
  }
  return Response.json(view)
}
