import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvidenceText } from './quotes.js'
/** Successful tool results kept byte-for-byte; collected is not the same as read by the judge. */
export function toolResultEvidence(id: string, events: readonly SessionEvent[], inherited: number): (EvidenceText & { tool: string })[] {
  if (!Number.isSafeInteger(inherited) || inherited < 0 || inherited > events.length) throw new Error('Invalid inherited prefix')
  const tools = new Map<string, string>()
  for (const event of events) if (event.type === 'assistant/message') {
    for (const block of event.data.message.content) if (block.type === 'tool-call') tools.set(block.id, block.name)
  }
  return events.flatMap(event => {
    if (event.seq < inherited || event.type !== 'tool/result' || event.data.message.isError) return []
    const tool = tools.get(event.data.message.toolCallId)
    if (!tool) return []
    const text = event.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
    return [{ id: `${id}:${event.seq}`, tool, text }]
  })
}
export function assistantEvidence(id: string, events: readonly SessionEvent[], inherited: number): EvidenceText[] {
  if (!Number.isSafeInteger(inherited) || inherited < 0 || inherited > events.length) throw new Error('Invalid inherited prefix')
  return events.flatMap(event => {
    if (event.seq < inherited || event.type !== 'assistant/message') return []
    const text = event.data.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
    return text.trim() ? [{ id: `${id}:${event.seq}`, text }] : []
  })
}
