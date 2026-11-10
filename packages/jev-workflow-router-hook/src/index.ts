/**
 * jev-workflow-router-hook host plugin.
 *
 * Reminds an agent, at most once, to fetch one Jev workflow-routing suggestion
 * when it is about to create an OpenSpec change (loading the
 * `openspec-propose` skill, or running `openspec new change` in bash) and it
 * has not used the router yet. Advisory only: it accepts every tool result
 * unchanged, never blocks or rewrites calls, never calls Jev itself and writes
 * nothing. Spec: openspec `jev-workflow-routing`, change
 * `add-jev-router-openspec-reminder-hook`.
 *
 * Pattern follows the official `@deepseek-ai/dsh-repeat-tool-reminder`:
 * `tools/post-execute` awaits downstream first, then prepends a labelled
 * notice to `additionalContexts`; per-agent state lives in a WeakMap.
 *
 * @module dsh-jev-workflow-router-hook
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'jev-workflow-router-hook': { kind: 'jev-workflow-router-hook' } & ContextFormed
  }
}

export const name = 'jev-workflow-router-hook'

export const REMINDER_TEXT =
  '你即将或刚刚创建 OpenSpec change。如果用户没有明确指定流程，任务也不属于已有的 change，' +
  '请先加载 `jev-workflow-router` skill 取一次路由建议（一行、非阻断），再继续；' +
  '否则忽略本提醒。'

const NEW_CHANGE_COMMAND = /\bopenspec\s+new\s+change\b/
const JEV_TOOL_SUFFIX = /jev_(?:classify|decide)$/
const DISABLED_VALUE = /^(?:1|true|yes|on)$/i

/** What a post-execute call means for the reminder. */
export type CallKind = 'router-used' | 'change-trigger' | 'other'

/** Classify one executed tool call by its name and parsed arguments. */
export function classifyCall(toolName: string, args: unknown): CallKind {
  if (JEV_TOOL_SUFFIX.test(toolName)) return 'router-used'
  const record = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (toolName === 'skill') {
    if (record.name === 'jev-workflow-router') return 'router-used'
    if (record.name === 'openspec-propose') return 'change-trigger'
    return 'other'
  }
  if (toolName === 'bash' && typeof record.command === 'string' && NEW_CHANGE_COMMAND.test(record.command)) {
    return 'change-trigger'
  }
  return 'other'
}

/** Runtime switches shared with the router skill. */
export interface Environment {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly skillDeployed: () => boolean
}

/** Whether the router (and so this reminder) is switched on. */
export function routerActive(environment: Environment): boolean {
  if (DISABLED_VALUE.test(environment.env.DSH_JEV_WORKFLOW_ROUTER_DISABLED ?? '')) return false
  return environment.skillDeployed()
}

function defaultEnvironment(): Environment {
  return {
    env: process.env,
    skillDeployed: () => {
      const home = process.env.DSH_HOME || join(homedir(), '.dsh')
      return existsSync(join(home, 'skills', 'jev-workflow-router', 'SKILL.md'))
    },
  }
}

function createReminder(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: REMINDER_TEXT }],
    source: { kind: 'jev-workflow-router-hook', form: 'notice', summary: '提醒：先取一次 Jev 路由建议' },
  })
}

interface AgentState {
  routerUsed: boolean
  reminded: boolean
}

/**
 * Install the post-execute listener.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param _config - unused; the plugin has no configuration.
 * @param environment - injectable switches (tests); defaults to process env and `$DSH_HOME`.
 */
export function apply(ctx: Context, _config?: unknown, environment: Environment = defaultEnvironment()): void {
  const states = new WeakMap<object, AgentState>()

  function observe(agent: object | undefined, toolName: string, args: unknown): UserMessage | undefined {
    if (!agent) return undefined
    const kind = classifyCall(toolName, args)
    if (kind === 'other') return undefined
    let state = states.get(agent)
    if (!state) {
      state = { routerUsed: false, reminded: false }
      states.set(agent, state)
    }
    if (kind === 'router-used') {
      state.routerUsed = true
      return undefined
    }
    if (state.routerUsed || state.reminded) return undefined
    if (!routerActive(environment)) return undefined
    state.reminded = true
    return createReminder()
  }

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const reminder = observe(exec.agent, exec.name, exec.arguments)
    const downstream = await next()
    if (!reminder) return downstream
    const additionalContexts = [reminder, ...(downstream.additionalContexts ?? [])]
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts }
    }
    return { ...downstream, additionalContexts }
  })
}
