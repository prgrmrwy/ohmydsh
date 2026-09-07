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
import { executePetContext, PET_CONTEXT_TOOL } from './context-tool.js'
import { PetError } from './errors.js'
import type { PetRepository } from './repository.js'



/**
 * Zero-argument by contract: there is no selector for a model to substitute.
 */
export const PET_CONTEXT_PARAMETERS = {} as const

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
 * There is exactly ONE: `pet_context`. Pet is a runtime, not a catalog of
 * per-capability adapters — an installed Skill drives ordinary DSH tools and
 * owns its own bounded behavior, so adding a capability never adds a tool.
 * @param ctx - A Pet executor's SCOPED agent context. Passing an unscoped
 * context (such as the Host plugin context) does not fail — it publishes the
 * tool to the global layer, where every ordinary session sees it.
 * @param deps - Repository supplying the caller's authorized Invocation.
 * @returns a disposer removing the registration.
 */
export function registerPetTools(
  ctx: Context,
  deps: { readonly repository: PetRepository },
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

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
