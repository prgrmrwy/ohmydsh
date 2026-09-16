/**
 * Pet Host tools registered on the executor Agent's scoped composition.
 *
 * There is exactly ONE, and that is the design: Pet is a runtime, not a
 * catalog of per-capability adapters. A capability is an installed Skill that
 * drives ordinary DSH tools and owns its own bounded behavior, so adding one
 * is an install rather than a code change.
 *
 * `pet_context` is CALLER-BOUND: it resolves the Invocation from the real
 * executing session id the agent loop sets on the execution, never from an
 * argument, and declares no parameters at all — so a model cannot substitute
 * a different Task or session.
 *
 * SCOPE IS PART OF THE CONTRACT. `ctx.tools.register()` resolves its target
 * layer from the CALLING context's scope tag and falls back to the GLOBAL
 * layer when there is none — silently, with no error. Registering from the
 * Host plugin context therefore published `pet_context` to every ordinary DSH
 * session, whose model was offered a tool that can only ever answer
 * `NOT_A_PET_SESSION`. Always register through a Pet executor's scoped agent
 * context (`executorSetup` in `src/index.ts`), never the Host context.
 *
 * Registration goes through `defineTool` so the parameter and output schemas
 * are checked at compile time. `parameters` is a FLAT property map (an
 * implicit open object root with per-property `required: true`), not a raw
 * JSON Schema object.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  executePetContext,
  PET_CONTEXT_TOOL,
  type PetContextDependencies,
} from './context-tool.js'
import { PetError } from './errors.js'
import type { PetRepository } from './repository.js'
import type { LarkClient } from './channel/lark.js'



/**
 * Zero-argument by contract: there is no selector for a model to substitute.
 */
export const PET_CONTEXT_PARAMETERS = {} as const
export const PET_LOCUS_FINISH_TOOL = 'pet_locus_finish'
export const PET_LOCUS_WAIT_TOOL = 'pet_locus_wait'

export type PetLocusFinishOutcome = 'reply' | 'no-reply'

export interface PetLocusFinishInput {
  readonly childSessionId: string
  readonly locus: import('./locus/context-repository.js').LocusContextRecord
  readonly delivery: import('./locus/context-repository.js').LocusCurrentDelivery
  readonly outcome: PetLocusFinishOutcome
  readonly text?: string
  readonly reason?: string
}

export interface PetLocusFinishResult { readonly sent: boolean; readonly outcome: PetLocusFinishOutcome }
export interface PetLocusWaitInput {
  readonly childSessionId: string
  readonly locus: import('./locus/context-repository.js').LocusContextRecord
  readonly delivery: import('./locus/context-repository.js').LocusCurrentDelivery
  readonly waitMinutes: number
  readonly reason?: string
}
export interface PetLocusWaitResult {
  readonly accepted: boolean
  readonly deadline: number
  readonly remainingMinutes: number
  readonly capped: boolean
}

export interface PetLocusLifecycleDependencies {
  readonly locusRepository: NonNullable<PetContextDependencies['locusRepository']>
  readonly authorizeCurrentDelivery?: (
    input: {
      readonly childSessionId: string
      readonly operation: 'finish' | 'wait'
      readonly proof?: {
        readonly deliveryId: string
        readonly executionId: string
        readonly turnId: string
        readonly source: 'delivery' | 'agent-message'
        readonly locusId: string
        readonly generation: number
        readonly childSessionId: string
      }
    },
  ) => import('./locus/context-repository.js').LocusContextRecord | undefined | Promise<import('./locus/context-repository.js').LocusContextRecord | undefined>
  readonly currentCapability?: (childSessionId: string) => {
    readonly deliveryId: string
    readonly executionId: string
    readonly turnId: string
    readonly source: 'delivery' | 'agent-message'
    readonly locusId?: string
    readonly generation?: number
  } | undefined
  readonly finishCurrentDelivery?: (input: PetLocusFinishInput) => PetLocusFinishResult | Promise<PetLocusFinishResult>
  readonly waitCurrentDelivery?: (input: PetLocusWaitInput) => PetLocusWaitResult | Promise<PetLocusWaitResult>
}

export interface PetLocusFinishDependencies extends PetLocusLifecycleDependencies {
  /**
   * Retained only as a composition-time capability description. The tool never
   * calls this adapter directly: finish must go through the durable lifecycle
   * callback so the Host can perform its finishing CAS and queue advancement.
   */
  readonly lark?: Pick<LarkClient, 'replyToTarget'>
}

/** Minimal execution view Pet reads; the agent loop sets `agent`. */
interface ExecutionLike {
  readonly agent?: { readonly session: { readonly id: unknown } }
}

type ToolArguments = Record<string, unknown>

/**
 * Validate the raw argument boundary even when a definition is invoked
 * directly by a test or an embedded caller instead of through ToolRuntime.
 * ToolRuntime also validates the schema, but this explicit check prevents a
 * selector or routing field from ever reaching a lifecycle callback when a
 * caller bypasses that pipeline.
 */
function requireKnownArguments(
  args: unknown,
  allowed: readonly string[],
  toolName: string,
): ToolArguments {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new PetError('INVALID_REQUEST', `${toolName} arguments must be an object.`)
  }
  const prototype = Object.getPrototypeOf(args)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PetError('INVALID_REQUEST', `${toolName} arguments must be a plain object.`)
  }
  for (const key of Reflect.ownKeys(args)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw new PetError('INVALID_REQUEST', `${toolName} does not accept argument '${String(key)}'.`)
    }
  }
  return args as ToolArguments
}

function hasOwnArgument(args: ToolArguments, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, name)
}

/**
 * Resolve the executing session id, failing closed when absent.
 *
 * Scoping the registration means a non-Pet session no longer even sees this
 * tool, so this guard is no longer the primary defense. It is kept because it
 * covers a DIFFERENT invariant: an execution that reaches the body with no
 * owning agent has no caller identity to resolve, and inventing one would be
 * the only way to answer. That must fail, whatever the tool's visibility.
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
 *
 * The stable surface is `pet_context` plus the caller-bound
 * `pet_locus_finish` and `pet_locus_wait` tools. Pet is not a catalog of per-capability adapters — an
 * installed Skill drives ordinary DSH tools and
 * owns its own bounded behavior, so adding a capability never adds a tool.
 * @param ctx - A Pet executor's SCOPED agent context. Passing an unscoped
 * context (such as the Host plugin context) does not fail — it publishes the
 * tool to the global layer, where every ordinary session sees it.
 * @param deps - Repository supplying the caller's authorized Invocation and,
 *   when integrated, an optional reverse locus lookup.
 * @returns a disposer removing the registration.
 */
export function registerPetTools(
  ctx: Context,
  deps: { readonly repository: PetRepository } & PetContextDependencies & {
    readonly locusLifecycle?: PetLocusFinishDependencies
  },
): () => void {
  const disposers: (() => void)[] = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: PET_CONTEXT_TOOL,
        description:
          'Return trusted caller-bound Pet context for this session. For an ordinary Pet ' +
          'executor this is the current Invocation snapshot; for a unified locus child it is ' +
          'the active locus, permission, anchor, and current Delivery when present. Takes no ' +
          'arguments: the target is resolved from the calling session and cannot be redirected.',
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
          const context = executePetContext(
            deps.repository,
            { agent: { session: { id: callerSessionId(exec as ExecutionLike) } } },
            deps,
          )
          return { json: JSON.stringify(context, null, 2) }
        },
      }),
    ),
  )

  const lifecycle = deps.locusLifecycle
  if (lifecycle !== undefined) {
    const resolveAuthorized = async (childSessionId: string, operation: 'finish' | 'wait') => {
      const authorize = lifecycle.authorizeCurrentDelivery ?? lifecycle.locusRepository.authorizeCurrentDelivery
      if (authorize === undefined) throw new PetError('INTERNAL', 'The Host has no caller/source authorization capability.')
      const proof = lifecycle.currentCapability?.(childSessionId)
      if (proof === undefined) throw new PetError('INVALID_REQUEST', 'This child has no current caller-authorized Feishu Delivery.')
      const authorized = await authorize({ childSessionId, operation, proof })
      if (authorized === undefined || authorized.locus.state !== 'active' || authorized.currentDelivery === undefined) {
        throw new PetError('INVALID_REQUEST', 'This child has no current caller-authorized Feishu Delivery.')
      }
      const delivery = authorized.currentDelivery
      // Keep the final boundary defensive even when a repository supplies its
      // own authorizer: no stale generation, backlog row, or malformed caller
      // projection may reach a lifecycle adapter.
      if (
        authorized.legacy === true ||
        authorized.source === 'legacy' ||
        authorized.child.sessionId !== childSessionId ||
        authorized.locus.locusId.trim() === '' ||
        !Number.isSafeInteger(authorized.locus.generation) ||
        authorized.locus.generation < 1 ||
        (authorized.permission.effective !== 'read' && authorized.permission.effective !== 'write') ||
        delivery.childSessionId !== childSessionId ||
        delivery.locusId !== authorized.locus.locusId ||
        delivery.generation !== authorized.locus.generation ||
        delivery.status !== 'current' ||
        (delivery.queueState !== undefined && delivery.queueState !== 'current')
      ) {
        throw new PetError('INVALID_REQUEST', 'This Delivery is no longer current or caller-authorized.')
      }
      return authorized
    }

    disposers.push(ctx.tools.register(defineTool({
      name: PET_LOCUS_FINISH_TOOL,
      description:
        'Finish the exact current Feishu Delivery with reply text or a no-reply reason. ' +
        'The Host derives all routing targets; do not provide ids. ' +
        'The text is sent as a Feishu text message: write `@Display Name` to mention a chat ' +
        'member and the Host renders it into a real mention before sending, so the person is ' +
        'notified. Only when the name you use differs from the group display name, write ' +
        '`<at user_id="ou_…">Name</at>` yourself (`<at user_id="all"></at>` mentions everyone). ' +
        'Copying the `@Name` form seen in inbound text produces plain text with no notification.',
      parameters: {
        outcome: { type: 'string', enum: ['reply', 'no-reply'], required: true },
        text: { type: 'string' },
        reason: { type: 'string' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          sent: { type: 'boolean', required: true }, outcome: { type: 'string', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: value.sent ? '已提交当前飞书请求。' : '当前请求未发送正文。' }],
      },
      async execute(args, exec) {
        const input = requireKnownArguments(args, ['outcome', 'text', 'reason'], PET_LOCUS_FINISH_TOOL)
        const outcome = input.outcome
        const text = typeof input.text === 'string' ? input.text : undefined
        const reason = typeof input.reason === 'string' ? input.reason : undefined
        if (outcome !== 'reply' && outcome !== 'no-reply') throw new PetError('INVALID_REQUEST', 'outcome must be reply or no-reply.')
        if (outcome === 'reply' && (!hasOwnArgument(input, 'text') || text === undefined || text.trim() === '' || hasOwnArgument(input, 'reason'))) throw new PetError('INVALID_REQUEST', 'reply requires non-empty text and no reason.')
        if (outcome === 'no-reply' && (hasOwnArgument(input, 'text') || !hasOwnArgument(input, 'reason') || reason === undefined || reason.trim() === '')) throw new PetError('INVALID_REQUEST', 'no-reply requires non-empty reason and no text.')
        const locus = await resolveAuthorized(callerSessionId(exec as ExecutionLike), 'finish')
        const delivery = locus.currentDelivery!
        if (lifecycle.finishCurrentDelivery === undefined) {
          // A direct Lark fallback would send without the durable finishing CAS,
          // result ledger, or queue advancement. Refuse instead of weakening
          // at-most-once semantics during partial composition.
          throw new PetError('INTERNAL', 'The Host has no durable Delivery finish capability.')
        }
        return lifecycle.finishCurrentDelivery({ childSessionId: delivery.childSessionId, locus, delivery, outcome, ...(text === undefined ? {} : { text }), ...(reason === undefined ? {} : { reason }) })
      },
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: PET_LOCUS_WAIT_TOOL,
      description: 'Extend the current Delivery lease by positive minutes from now, bounded by the acceptedAt plus 24 hour hard cap.',
      parameters: { waitMinutes: { type: 'number', required: true }, reason: { type: 'string' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          accepted: { type: 'boolean', required: true }, deadline: { type: 'number', required: true }, remainingMinutes: { type: 'number', required: true }, capped: { type: 'boolean', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: `等待期限：${String(value.deadline)}` }],
      },
      async execute(args, exec) {
        const input = requireKnownArguments(args, ['waitMinutes', 'reason'], PET_LOCUS_WAIT_TOOL)
        const waitMinutes = input.waitMinutes
        if (typeof waitMinutes !== 'number' || !Number.isSafeInteger(waitMinutes) || waitMinutes < 1 || waitMinutes > 1440) throw new PetError('INVALID_REQUEST', 'waitMinutes must be an integer from 1 through 1440.')
        if (hasOwnArgument(input, 'reason') && typeof input.reason !== 'string') throw new PetError('INVALID_REQUEST', 'reason must be a string when provided.')
        const locus = await resolveAuthorized(callerSessionId(exec as ExecutionLike), 'wait')
        if (lifecycle.waitCurrentDelivery === undefined) throw new PetError('INTERNAL', 'The Host has no durable Delivery wait lease.')
        const reason = typeof input.reason === 'string' ? input.reason : undefined
        return lifecycle.waitCurrentDelivery({ childSessionId: locus.currentDelivery!.childSessionId, locus, delivery: locus.currentDelivery!, waitMinutes, ...(reason === undefined ? {} : { reason }) })
      },
    })))
  }

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
