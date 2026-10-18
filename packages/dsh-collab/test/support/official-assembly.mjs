import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { presets, moduleOf } from './controller-harness.mjs'
export const name = 'collab-official-session-fixture'
export const inject = ['agentPresets', 'sessionController', 'sessions', 'llm']
export async function apply(ctx, config) {
  const { LlmAdapter } = await moduleOf('dsh-llm')
  class Scripted extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'local-only' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'local-only' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['scripted'], new Scripted())
  await presets(ctx)
  const { SessionId } = await moduleOf('dsh-session')
  const id = SessionId('direct-caller'), cwd = join(config.root, 'workspace')
  await mkdir(cwd, { recursive: true })
  if (!config.replay) await ctx.sessionController.create({ sessionId: id, cwd, agentPreset: 'P1' })
  const result = await ctx.sessionController.resolveAgent(id)
  if (!result.agent) throw new Error('direct composition caller unavailable')
  await ctx.sessions.flush(result.agent.session)
}
