import type { SessionController, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { sendRecordedPrompt } from './prompt-ledger.js'
import type { TestedSessionPort } from './executor.js'

export function controllerExecutionPort(controller: SessionController, routing: (operation: 'state' | 'setMode', payload: unknown) => Promise<unknown>, cwd: string, signal: AbortSignal, receiptDirectory?: string): TestedSessionPort {
  const resolve = async (id: string) => {
    const result = await controller.resolveAgent(SessionId(id))
    if (!('agent' in result)) throw new Error('Test session unavailable')
    return result.agent
  }
  return {
    async create(id) {
      const actual = await controller.create({ sessionId: SessionId(id), cwd, agentPreset: 'standard' })
      if (actual.sessionId !== id) throw new Error('Ordinary test session identity mismatch')
      const agent = await resolve(id)
      if (agent.id !== id || agent.session.header.cwd !== cwd || agent.session.header.agentPreset !== 'standard') throw new Error('Test session workspace or preset mismatch')
    },
    async rename(id, title) { await controller.rename({ sessionId: SessionId(id), title }) },
    async setManual(id) { await routing('setMode', { sessionId: id, mode: 'MANUAL' }) },
    async selectModel(id, route) { await controller.selectModel({ sessionId: SessionId(id), provider: route.provider, model: route.model, ...(route.effort === undefined ? {} : { reasoningEffort: route.effort }) }) },
    async inspect(id) {
      const agent = await resolve(id)
      const events = agent.session.snapshotEvents()
      const title = events.filter(event => event.type === 'session/title').at(-1)
      const model = events.filter(event => event.type === 'model/selection' || event.type === 'request/header').at(-1)
      const selection = model?.type === 'model/selection' ? model.data : model?.type === 'request/header' ? model.data.header.config : undefined
      const state = await routing('state', { sessionId: id }) as { mode?: string }
      return {
        title: title?.data.title ?? '', userPinned: title?.data.source.kind === 'user', mode: state.mode ?? 'unknown',
        route: { provider: selection?.provider ?? '', model: selection?.model ?? '', ...(selection?.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort }) },
      }
    },
    async prompt(id, text, turn = 'initial') {
      if (!receiptDirectory) throw new Error('Durable prompt receipt directory required')
      if (signal.aborted) throw new Error('Test execution aborted')
      const send = async (requestId: string): Promise<void> => {
        await controller.prompt({ sessionId: SessionId(id), requestId: requestId as SessionRequestId, mode: 'queue', content: [{ type: 'text', text }] }, signal)
      }
      const agent = await resolve(id)
      const cancel = () => { agent.cancel({ kind: 'user' }) }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        if (signal.aborted) throw new Error('Test execution aborted')
        await sendRecordedPrompt(receiptDirectory, id, turn, text, send)
        // SessionController checks signal only at entry, then awaits attachment admission.
        // Re-cancel after it returns; the Host request gate also rejects the admission race.
        if (signal.aborted) cancel()
        await agent.whenIdle()
        if (signal.aborted) throw new Error('Test execution aborted')
      } finally { signal.removeEventListener('abort', cancel) }
    },
  }
}
