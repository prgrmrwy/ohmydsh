import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
      ? { kind: 'plugin' as const, plugin: 'dsh-memex', form, summary: summary ?? 'Memex reminder' }
      : { kind: 'plugin' as const, plugin: 'dsh-memex', form },
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

  ctx.on('agent/session-start', ({ agent, source }) => {
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
