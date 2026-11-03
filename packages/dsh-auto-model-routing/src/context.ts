/** Shape-based, best effort: applied to the whole text before any truncation. */
const RULES: readonly [RegExp, string][] = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '<redacted>'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer <redacted>'],
  [/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g, '<redacted>'],
  [/(密码|授权码|appid|password|passwd|token|api[_-]?key|secret)(["']?\s*[:：=]\s*["']?)[^\s"',;]+/gi, '$1$2<redacted>'],
  [/\/\/[^\s/:@]+:[^\s/@]+@/g, '//<redacted>@'],
  [/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '<ip>'],
]

export function redact(text: string): string {
  return RULES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text)
}

interface HistoryMessage { role: string; source?: { kind: string }; content: readonly { type: string; text?: string }[] }
const textOf = (message: HistoryMessage): string =>
  message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')

/** The previous turn, read from history before this turn's messages enter. Raw text: `buildState` redacts. */
export function previousTurn(messages: readonly HistoryMessage[]): { user?: string; assistant?: string } {
  const user = messages.findLast(message => message.source?.kind === 'user')
  const assistant = messages.findLast(message => message.role === 'assistant' && message.content.some(block => block.type === 'text' && block.text))
  return { ...(user ? { user: textOf(user) } : {}), ...(assistant ? { assistant: textOf(assistant) } : {}) }
}

const EXPLAIN = 'Earlier conversation is shown so you can tell what the new message asks for. Rate the work the assistant must do next in response to the new message, not the earlier work.'

/** The Jev `state`; every section is redacted, then cut. The fixed first line keeps the request bytes stable. */
export function buildState(input: { prevUser?: string | undefined; prevAssistant?: string | undefined; text: string }): string {
  const lines = ['Previous user-turn tier: none']
  const context = input.prevUser !== undefined || input.prevAssistant !== undefined
  if (context) lines.push(EXPLAIN)
  if (input.prevUser !== undefined) lines.push('Previous user message (truncated):', redact(input.prevUser).slice(0, 500))
  if (input.prevAssistant !== undefined) lines.push('Previous assistant reply (last part):', redact(input.prevAssistant).slice(-1200))
  lines.push(context ? 'New user message:' : 'User message:', redact(input.text).slice(0, 8000))
  return lines.join('\n')
}
