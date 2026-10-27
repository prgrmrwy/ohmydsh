import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** One main-session model selection as the AUTO support gate needs it. */
export interface MainSelection { provider: string; model: string }

/**
 * AUTO only manages the Claude / GPT model families.
 *
 * The transport prefix (`claude/...`, `codex/...` on Magpie) is not part of the
 * family name, so it is stripped before matching. Every other family — DeepSeek,
 * GLM, Grok, Gemini, Kimi, Qwen, ... — is explicitly out of scope and locks the
 * session to MANUAL instead of being guessed at.
 */
export function autoSupportedModel(model: string | undefined): boolean {
  if (typeof model !== 'string' || model.length === 0) return false
  const bare = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model
  return /^(?:claude|gpt)-/i.test(bare)
}

/** An unknown selection must never lock a session: only a proven mismatch does. */
export function mainSupported(selection: MainSelection | undefined): boolean {
  return selection === undefined || autoSupportedModel(selection.model)
}

interface ModelSelectionProjection { pending?: { provider?: unknown; model?: unknown } | null }

/**
 * The main session's current model selection, most-authoritative signal first:
 * the official pending pick (`model/selection` projection), then the last actual
 * request header, then the creation-time agent options. Undefined when none can
 * be read; callers treat that as "unknown, do not lock".
 */
export function currentMainSelection(ctx: Context, agent: Agent): MainSelection | undefined {
  try {
    const service = (ctx as unknown as { get(name: string): unknown }).get('sessionProjections') as
      { stateOf(session: unknown, key: string): ModelSelectionProjection | undefined } | undefined
    const pending = service?.stateOf(agent.session, 'modelSelection')?.pending
    if (pending && typeof pending.provider === 'string' && typeof pending.model === 'string') return { provider: pending.provider, model: pending.model }
  } catch { /* optional projection: fall through to the durable header */ }
  const header = agent.session.requestHeader()?.config
  if (header && typeof header.provider === 'string' && typeof header.model === 'string') return { provider: header.provider, model: header.model }
  const options = agent.options
  if (typeof options.provider === 'string' && typeof options.model === 'string') return { provider: options.provider, model: options.model }
  return undefined
}
