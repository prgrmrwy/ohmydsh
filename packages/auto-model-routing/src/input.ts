import { redact } from './context.js'
export interface ClaimedMessage {
  source?: { kind: string }
  content: readonly { type: string; text?: string }[]
}

export function userInput(messages: readonly ClaimedMessage[]): { userTurn: boolean; text: string } {
  const eligible = messages.filter(message => message.source?.kind === 'user')
  return {
    userTurn: eligible.length > 0,
    text: redact(eligible.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text ?? '')).join('\n')).slice(0, 8000),
  }
}
