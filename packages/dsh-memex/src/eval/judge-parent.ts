import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ScopeService } from '../scope/types.js'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
export async function createJudgeParent(ctx: Context, input: { id: string; cwd: string; preset: string }, scopes: Pick<ScopeService, 'resolve'>): Promise<AgentHandle> {
  const route = scopes.resolve(input.cwd)
  if (route.memory !== false || route.fallback !== false || route.personal.read || route.personal.write) throw new Error('Judge workspace must disable memory and fallback')
  const presets = ctx.get('agentPresets'), agents = ctx.get('agents')
  if (!presets || !agents) throw new Error('Required judge parent service unavailable')
  return agents.create({ sessionId: SessionId(input.id), meta: { cwd: input.cwd }, setup: async child => {
    await presets.mount(child, input.preset)
  } })
}
export function requirePristineJudgeParent(parent: Agent): void {
  if (parent.inbox.nextTurn.length || parent.inbox.nextStep.length || parent.session.snapshotEvents().some(event => event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'request/header')) {
    throw new Error('Judge parent contaminated by prompt or model activity')
  }
}
