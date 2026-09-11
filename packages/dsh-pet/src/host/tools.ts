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
export const PET_LOCUS_REPLY_TOOL = 'pet_locus_reply'

export interface PetLocusReplyDependencies {
  /** The same caller-bound context resolver used by pet_context. */
  readonly locusRepository: NonNullable<PetContextDependencies['locusRepository']>
  /** Bot client fixed to the dsh-pet profile and bot identity. */
  readonly lark: Pick<LarkClient, 'reply' | 'replyExact'>
}

/** Minimal execution view Pet reads; the agent loop sets `agent`. */
interface ExecutionLike {
  readonly agent?: { readonly session: { readonly id: unknown } }
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
 * The stable surface is `pet_context` plus the optional caller-bound
 * `pet_locus_reply`. Pet is not a catalog of per-capability adapters — an
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
    readonly locusReply?: PetLocusReplyDependencies
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

  if (deps.locusReply !== undefined) {
    disposers.push(
      ctx.tools.register(
        defineTool({
          name: PET_LOCUS_REPLY_TOOL,
          description:
            'Reply as the Pet bot to the exact current Feishu Delivery. Takes only the business ' +
            'text: chat/thread/message targets are resolved from the caller child and current turn, ' +
            'and the tool is unavailable to GUI, initialization, or stale turns.',
          parameters: {
            text: { type: 'string', required: true },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { sent: { type: 'boolean', required: true } },
            },
            render: (_args, value) => [{ type: 'text', text: value.sent ? '已发送到当前飞书入口。' : '未发送。' }],
          },
          async execute(args, exec) {
            const childSessionId = callerSessionId(exec as ExecutionLike)
            const matches = deps.locusReply!.locusRepository.findByChildSessionId(childSessionId)
            if (matches.length !== 1 || matches[0]?.locus.state !== 'active') {
              throw new PetError('NOT_A_PET_SESSION', 'Current child has no unique active locus.')
            }
            const delivery = matches[0].currentDelivery
            if (delivery?.replyTarget === undefined) {
              throw new PetError(
                'INVALID_REQUEST',
                'This turn has no exact Feishu Delivery reply target; GUI and stale turns cannot send.',
              )
            }
            const exact = deps.locusReply!.lark.replyExact
            if (exact === undefined) {
              throw new PetError(
                'INTERNAL',
                'The Host has no strict Feishu reply adapter; refusing an unverified send.',
              )
            }
            await exact(delivery.replyTarget.messageId, args.text)
            return { sent: true }
          },
        }),
      ),
    )
  }

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
