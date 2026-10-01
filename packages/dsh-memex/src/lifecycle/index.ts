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
  /**
   * The turn that closed while a write reminder was owed, or undefined when none
   * is scheduled. The reminder is delivered with a LATER turn's first step, never
   * in this one, so it cannot add a model step to the turn it was scheduled in.
   */
  pendingSince: number | undefined
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

/** A write reminder is owed: memory is on, something was recalled, nothing was written, none delivered yet. */
function reminderOwed(state: SessionState): boolean {
  return !state.off && state.recalled && !state.wrote && !state.reminded
}

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
    const created: SessionState = { recalled: false, wrote: false, reminded: false, off: false, pendingSince: undefined }
    states.set(session, created)
    return created
  }

  ctx.on('agent/session-start', ({ agent, source }) => {
    const sessionState = state(agent.session)
    // A scheduled reminder belongs to the recall it followed; every reset below
    // ends that recall, so the reminder goes with it.
    sessionState.pendingSince = undefined
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

  // Closing a turn only SCHEDULES the reminder. Injecting here would make the
  // host run one more step inside the closing turn, so the model would answer,
  // then be pulled back to write a card, and the turn's last message (the only
  // one the web UI shows in full) would be the card report instead of the answer.
  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const current = state(agent.session)
    if (!reminderOwed(current) || current.pendingSince !== undefined) return
    current.pendingSince = turn
  })

  // The scheduled reminder rides along with the first later step that already
  // carries input, appended after everything the rest of the chain admitted.
  // Runs on every step of every agent, so it stays O(1) and allocates nothing
  // while no reminder is scheduled.
  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next) => {
    const decision = await next()
    const current = states.get(agent.session)
    const since = current?.pendingSince
    if (current === undefined || since === undefined) return decision
    // What earned the reminder may be gone by now (a card was written meanwhile).
    if (!reminderOwed(current)) { current.pendingSince = undefined; return decision }
    if (decision.kind !== 'enter' || signal.aborted) return decision
    // Never the turn that scheduled it, and never a step with nothing else in
    // it: a message added there would itself make the host open a model request.
    if (turn <= since || decision.messages.length === 0) return decision
    current.pendingSince = undefined
    // This runs on every step of every agent, so a nudge that cannot be built
    // must cost only the nudge: log it and let the step go ahead untouched, as
    // the turn-close injection this replaces did. State changes only after the
    // message exists, so a failure leaves the reminder owed and it is scheduled
    // again at the next turn close (one warning per turn at most).
    let reminder: ReturnType<typeof pluginMessage>
    try {
      reminder = pluginMessage(RETRO_TEXT, 'notice', 'Memex write reminder')
    } catch (error) {
      ctx.logger('dsh-memex').warn('Could not build memex write reminder: %s', error instanceof Error ? error.message : String(error))
      return decision
    }
    current.reminded = true
    return { ...decision, messages: [...decision.messages, reminder] }
  })

  return {
    mark(tool, session) {
      const current = state(session)
      if (tool === 'recall') current.recalled = true
      else { current.wrote = true; current.reminded = false }
    },
  }
}
