import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'

/**
 * dsh-memex's own message source kind.
 *
 * DSH 0.2.0 (session format v4) removed the shared `{ kind: 'plugin', plugin }`
 * wrapper: every producer declares its own kind, and a v4 reader refuses a
 * `plugin` source outright, so writing the old shape would leave a session that
 * cannot be reopened. The v3→v4 migration renames historical memex rows to
 * `plugin:dsh-memex` (session-format-v3-to-v4 `producerKind`), so new rows use
 * the same kind and old and new history read as one producer. DSH 0.1.5 accepts
 * any non-empty kind on a user message.
 */
export const MEMEX_SOURCE_KIND = 'plugin:dsh-memex'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:dsh-memex': { kind: 'plugin:dsh-memex' } & ContextFormed
  }
}

/** `SessionStartSource` as declared by dsh-agent in 0.1.5 and 0.2.0. */
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
import type { ScopeService } from '../scope/types.js'

interface SessionState {
  recalled: boolean
  wrote: boolean
  reminded: boolean
  /** True once this session's workspace was found to have memory switched off. */
  off: boolean
}

const RECALL_TEXT = [
  '## Memex Memory System Active',
  '',
  'A persistent Zettelkasten memory is available through the memex tools.',
  'Before substantive work likely related to prior decisions or debugging, call memex_recall.',
  'Read relevant cards with memex_read and use memex_search for focused lookup.',
  'After the task, save only non-obvious reusable learnings with memex_retro.',
  'Never include actual secrets, credentials, tokens, or exact secret file contents.',
  'Recall guardrails: follow at most 3 link hops and read at most 20 cards.',
].join('\n')

const RETRO_TEXT = '**Memex reminder:** If this task produced a non-obvious reusable learning, call memex_retro before finishing.'

function pluginMessage(text: string, form: 'instructions' | 'notice', summary?: string) {
  return createUserMessage({
    content: [{ type: 'text' as const, text }],
    source: form === 'notice'
      ? { kind: MEMEX_SOURCE_KIND, form, summary: summary ?? 'Memex reminder' }
      : { kind: MEMEX_SOURCE_KIND, form },
  })
}

export interface MemexLifecycle {
  mark(tool: 'recall' | 'retro' | 'write', session: object): void
}

export function registerMemexLifecycle(ctx: Context, scopes: ScopeService): MemexLifecycle {
  const states = new WeakMap<object, SessionState>()
  const state = (session: object): SessionState => {
    const found = states.get(session)
    if (found) return found
    const created = { recalled: false, wrote: false, reminded: false, off: false }
    states.set(session, created)
    return created
  }

  // Inject at the Agent publication boundary. `agent/created` fires once per
  // fresh creation or cold resume, after setup and before the first driver step,
  // in both DSH 0.1.5 (emit) and 0.2.0 (serial, awaited before queued input);
  // 0.2.0 removed `agent/session-start`. 0.1.5 carries no `source` here, so an
  // absent source is a (re)start. Neither runtime currently emits `compact` or
  // `clear` through this lifecycle; the compact branch is kept for when it does.
  const seedRecall = (agent: Agent, source: SessionStartSource | undefined): void => {
    const sessionState = state(agent.session)
    if (source === 'compact') { sessionState.recalled = false; sessionState.reminded = false }
    else { sessionState.recalled = false; sessionState.wrote = false; sessionState.reminded = false; sessionState.off = false }

    try {
      const cwd = agent.session.header.cwd
      if (!cwd) return
      const scope = scopes.resolve(cwd)
      // Memory off is a workspace decision: injecting the recall prompt would
      // invite calls the tools then refuse, so the session is left alone.
      sessionState.off = !scope.memory
      if (sessionState.off) return
      agent.inject(pluginMessage(`${RECALL_TEXT}\n\nCurrent memory scope: ${scope.scope}\nLibrary: ${scope.home}`, 'instructions'))
    } catch (error) {
      ctx.logger('dsh-memex').warn('Could not inject memex recall context: %s', error instanceof Error ? error.message : String(error))
    }
  }

  // The listener only seeds an inject; it never awaits. The explicit undefined
  // return satisfies 0.2.0's serial `Promise<undefined> | undefined` contract
  // and is harmless on 0.1.5's emit dispatch.
  ctx.on('agent/created', (payload: { agent: Agent; source?: SessionStartSource }) => {
    seedRecall(payload.agent, payload.source)
    return undefined
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    const current = state(agent.session)
    if (current.off || !current.recalled || current.wrote || current.reminded) return
    current.reminded = true
    try {
      agent.inject(pluginMessage(RETRO_TEXT, 'notice', 'Memex write reminder'))
    } catch (error) {
      current.reminded = false
      ctx.logger('dsh-memex').warn('Could not inject memex write reminder: %s', error instanceof Error ? error.message : String(error))
    }
  })

  return {
    mark(tool, session) {
      const current = state(session)
      if (tool === 'recall') current.recalled = true
      else { current.wrote = true; current.reminded = false }
    },
  }
}
