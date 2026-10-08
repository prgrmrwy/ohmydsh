/**
 * An Agent double that enforces what the real `Agent` relies on (stable message id, a known source kind,
 * a real inbox target, and waking delivery) instead of recording whatever it is handed. Shared by every
 * command test so none of them can drift back to an invented delivery shape.
 */
// DSH 0.2 MessageSourceMap core kinds plus producer-owned `plugin:<name>` kinds; the bare `plugin` kind was removed.
const SOURCE_KINDS = new Set(['user', 'model', 'tool', 'system-prompt'])
const isKnownKind = (kind: unknown) => typeof kind === 'string' && (SOURCE_KINDS.has(kind) || /^plugin:[a-z0-9][a-z0-9.-]*$/.test(kind))
const TARGETS = new Set(['next-turn', 'next-step'])

export function strictAgent(cwd: string | undefined, extra: Record<string, unknown> = {}) {
  const delivered: Array<{ message: any; target: string; wakeup: boolean }> = []
  const push = (message: any, target: string, wakeup: boolean) => {
    if (typeof message?.id !== 'string' || message.id === '') throw new Error('message has no stable id')
    if (message.role !== 'user' || !Array.isArray(message.content)) throw new Error('not a user message')
    if (!isKnownKind(message.source?.kind)) throw new Error(`unknown message source kind: ${message.source?.kind}`)
    if (!TARGETS.has(target)) throw new Error(`invalid inbox target: ${JSON.stringify(target)}`)
    delivered.push({ message, target, wakeup })
  }
  const agent = {
    session: { header: cwd === undefined ? {} : { cwd } },
    send: (message: any, target: string, wakeup: boolean) => push(message, target, wakeup),
    followup: (message: any) => push(message, 'next-turn', true),
    steer: (message: any) => push(message, 'next-step', true),
    ...extra,
  }
  /** Text of every delivered message, in order. */
  const texts = () => delivered.map(item => String(item.message.content?.[0]?.text ?? ''))
  return { agent, delivered, texts }
}
