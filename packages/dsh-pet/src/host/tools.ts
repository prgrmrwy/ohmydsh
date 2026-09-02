/**
 * Pet Host tools registered on the executor Agent's scoped composition.
 *
 * Both tools are CALLER-BOUND: they resolve their target from the real
 * executing session id that the agent loop sets on the execution, never from
 * an argument. `pet_context` declares no parameters at all, and
 * `pet_clean_worktree` accepts only a boolean confirmation — so a model
 * cannot substitute a different Task, session, worktree or branch.
 *
 * Registration goes through `defineTool` so the parameter and output schemas
 * are checked at compile time. `parameters` is a FLAT property map (an
 * implicit open object root with per-property `required: true`), not a raw
 * JSON Schema object.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { executePetContext, PET_CONTEXT_TOOL } from './context-tool.js'
import {
  runCleanWorktree,
  type HostActivity,
  type WorktreeMaintenance,
} from './clean-worktree.js'
import { PetError } from './errors.js'
import { runCreateMr } from './create-mr.js'
import { runSendCr } from './send-cr.js'
import type { PetRepository } from './repository.js'

/** Tool name for the bounded worktree cleanup. */
export const PET_CLEAN_WORKTREE_TOOL = 'pet_clean_worktree'

/** Tool name for the bounded merge-request creation. */
export const PET_CREATE_MR_TOOL = 'pet_create_mr'

/** Tool name for the bounded CR notification. */
export const PET_SEND_CR_TOOL = 'pet_send_cr'

/** MR content only; the repository and branch come from trusted context. */
export const PET_CREATE_MR_PARAMETERS = {
  title: { type: 'string', required: true, description: 'Merge request title.' },
  body: { type: 'string', description: 'Merge request description.' },
  base: { type: 'string', description: 'Target branch; omitted uses the repository default.' },
  reviewers: {
    type: 'array',
    items: { type: 'string' },
    description: 'Reviewer usernames the user explicitly named.',
  },
  push: { type: 'boolean', description: 'Push the source branch before creating the MR.' },
} as const

/** CR content only; the destination comes from the trusted workspace binding. */
export const PET_SEND_CR_PARAMETERS = {
  mrUrl: { type: 'string', required: true, description: 'Merge request URL to review.' },
  note: { type: 'string', description: 'Optional short note appended to the fixed template.' },
} as const

/**
 * Zero-argument by contract: there is no selector for a model to substitute.
 */
export const PET_CONTEXT_PARAMETERS = {} as const

/** Only a confirmation gate; the target still comes from trusted context. */
export const PET_CLEAN_WORKTREE_PARAMETERS = {
  confirm: {
    type: 'boolean',
    description:
      'false previews the actions (dry run); true performs the cleanup after the user has ' +
      'explicitly approved that preview.',
  },
} as const

/** Minimal execution view Pet reads; the agent loop sets `agent`. */
interface ExecutionLike {
  readonly agent?: { readonly session: { readonly id: unknown } }
}

/**
 * Resolve the executing session id, failing closed when absent.
 * @param exec - The tool execution.
 * @returns the executing session id.
 * @throws PetError when the call has no owning agent.
 */
function callerSessionId(exec: ExecutionLike): string {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined || sessionId === null) {
    throw new PetError(
      'NOT_A_PET_SESSION',
      'This tool must be called from a Pet executor Agent session.',
    )
  }
  return String(sessionId)
}

/**
 * Register Pet's Agent-facing tools.
 * @param ctx - The scoped agent context (or Host context).
 * @param deps - Repository, optional worktree maintenance and Host activity.
 * @returns a disposer removing both registrations.
 */
export function registerPetTools(
  ctx: Context,
  deps: {
    readonly repository: PetRepository
    readonly maintenance: WorktreeMaintenance | undefined
    readonly activity: HostActivity
  },
): () => void {
  const disposers: (() => void)[] = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: PET_CONTEXT_TOOL,
        description:
          'Return the trusted source context of the Pet Invocation this session is currently ' +
          'executing. Takes no arguments: the target is resolved from the calling session and ' +
          'cannot be redirected. Call this at the start of every Invocation.',
        parameters: PET_CONTEXT_PARAMETERS,
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { json: { type: 'string', required: true } },
          },
          render: (_args, value) => [{ type: 'text', text: value.json }],
        },
        async execute(_args, exec) {
          const context = executePetContext(deps.repository, {
            agent: { session: { id: callerSessionId(exec as ExecutionLike) } },
          })
          return { json: JSON.stringify(context, null, 2) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: PET_CLEAN_WORKTREE_TOOL,
        description:
          "Clean the isolated Git worktree of this Invocation's source session, delegating to " +
          'the existing Worktree Session safety gates. The target comes from the trusted ' +
          'snapshot and cannot be supplied. Call with confirm=false first to preview; a ' +
          'refusal is final and must not be worked around.',
        parameters: PET_CLEAN_WORKTREE_PARAMETERS,
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { json: { type: 'string', required: true } },
          },
          render: (_args, value) => [{ type: 'text', text: value.json }],
        },
        async execute(args, exec) {
          const outcome = await runCleanWorktree({
            repository: deps.repository,
            maintenance: deps.maintenance,
            activity: deps.activity,
            executorSessionId: callerSessionId(exec as ExecutionLike),
            confirm: args.confirm === true,
          })
          return { json: JSON.stringify(outcome, null, 2) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: PET_CREATE_MR_TOOL,
        description:
          'Create a Codebase merge request for the repository and branch of this Invocation. ' +
          'The target is resolved from the trusted snapshot and cannot be supplied: there is ' +
          'no repository or branch parameter. A refusal is final.',
        parameters: PET_CREATE_MR_PARAMETERS,
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { json: { type: 'string', required: true } },
          },
          render: (_args, value) => [{ type: 'text', text: value.json }],
        },
        async execute(args, exec) {
          const outcome = await runCreateMr({
            repository: deps.repository,
            executorSessionId: callerSessionId(exec as ExecutionLike),
            request: {
              title: args.title,
              ...(args.body !== undefined ? { body: args.body } : {}),
              ...(args.base !== undefined ? { base: args.base } : {}),
              ...(args.reviewers !== undefined ? { reviewers: args.reviewers } : {}),
              ...(args.push !== undefined ? { push: args.push } : {}),
            },
          })
          return { json: JSON.stringify(outcome, null, 2) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: PET_SEND_CR_TOOL,
        description:
          'Send a Code Review request for a merge request to the group configured for this ' +
          "source's workspace. The destination comes from the trusted binding and cannot be " +
          'supplied: there is no chat, group or user parameter.',
        parameters: PET_SEND_CR_PARAMETERS,
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { json: { type: 'string', required: true } },
          },
          render: (_args, value) => [{ type: 'text', text: value.json }],
        },
        async execute(args, exec) {
          const outcome = await runSendCr({
            repository: deps.repository,
            executorSessionId: callerSessionId(exec as ExecutionLike),
            request: {
              mrUrl: args.mrUrl,
              ...(args.note !== undefined ? { note: args.note } : {}),
            },
          })
          return { json: JSON.stringify(outcome, null, 2) }
        },
      }),
    ),
  )

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
