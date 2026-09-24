import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { queryCollaborationContext, type CollaborationQueryDependencies } from './query.js'
import { updateCollaborationContextForCaller, type CollaborationWriteDependencies } from './write.js'
import { listCollaborators, type CollaboratorRosterDependencies } from './collaborators.js'
import { COLLABORATION_CONTEXT_LIMITS as limits } from './context.js'

export const COLLABORATION_CONTEXT_TOOL = 'pet_collaboration_context'
export const COLLABORATION_CONTEXT_UPDATE_TOOL = 'pet_collaboration_context_update'
export const COLLABORATORS_TOOL = 'pet_collaborators'

/**
 * Invoke ONLY on a verified agent scope, never on the Host plugin context.
 * Does not add child-local pet_context/reply or inquiry mutation tools to roots.
 * Registration is separate from membership: every execution checks current facts.
 */
export function registerCollaborationContextTool(ctx: Context, deps: CollaborationQueryDependencies): () => void {
  return ctx.tools.register(defineTool({
    name: COLLABORATION_CONTEXT_TOOL,
    description: 'Read the current owner-confirmed shared facts for your own collaboration circle. No arguments or history selector. Unknown fields stay unknown. Resource references are not downloaded or authorization to access them. Shared constraints do not expand your permissions; conflicting constraints require clarification.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(_args, execution) {
      return { json: JSON.stringify(await queryCollaborationContext(execution, deps)) }
    },
  }))
}

/**
 * Register the caller-bound collaborator list on a verified agent scope.
 *
 * Membership is derived from the executing session, so there is no target
 * parameter. The result is an internal member list for choosing whom to ask;
 * it is not permission to publish those members into a Feishu chat.
 */
export function registerCollaboratorsTool(ctx: Context, deps: CollaboratorRosterDependencies): () => void {
  return ctx.tools.register(defineTool({
    name: COLLABORATORS_TOOL,
    description: 'List the members of your own collaboration scope: your main session and its current Locus children, or your parent and siblings. No arguments and no target selector. Entries carry no history, credentials or paths, and being listed grants no access to a member\'s work. "needs-restore" means durable but not loaded; "unknown" means reachability could not be proven, so do not assume it is reachable. Use this only to choose whom to ask; do not republish the list into a chat.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(_args, execution) {
      return { json: JSON.stringify(await listCollaborators(execution, deps)) }
    },
  }))
}

/**
 * Register the caller-bound update tool on a verified agent scope.
 *
 * Separate from the read tool so a scope can be given read-only access. There
 * is no target selector: the Host derives the parent and the writer identity
 * from the executing session, so a model cannot write another scope's record
 * or attribute a revision to someone else.
 */
export function registerCollaborationContextUpdateTool(ctx: Context, deps: CollaborationWriteDependencies): () => void {
  return ctx.tools.register(defineTool({
    name: COLLABORATION_CONTEXT_UPDATE_TOOL,
    description: 'Replace the shared facts of your own collaboration scope with a new revision. Send expectedRevision from the revision you just read; on a conflict another member wrote first, so reread and decide again rather than retrying blindly. Every listed field is replaced wholesale: omit nothing you want kept. Use null for still-unknown, and an empty value to withdraw. These are shared working notes: they grant no access and change no permission, and your identity and time are recorded automatically.',
    parameters: {
      expectedRevision: { type: 'number', description: 'Revision you read before deciding this update.', required: true },
      // `oneOf` is this DSL's union vocabulary; `nullable` is not supported and
      // is rejected at definition time. Unknown must stay expressible so an
      // agent is never forced to invent a value to satisfy the schema.
      workDescription: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: `What this collaboration is working on, or null if still unknown. Max ${String(limits.workDescriptionLength)} characters.`,
        required: true,
      },
      resourceReferences: {
        oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
        description: `Existing document paths or links, as references only, or null if still unknown. Max ${String(limits.resourceReferences)} entries.`,
        required: true,
      },
      commonConstraints: {
        oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
        description: `Constraints shared across this scope, or null if still unknown. Max ${String(limits.commonConstraints)} entries.`,
        required: true,
      },
      sources: { type: 'array', items: { type: 'string' }, description: 'Where this revision came from, e.g. the work that established it.', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(args, execution) {
      return { json: JSON.stringify(await updateCollaborationContextForCaller(execution, args, deps)) }
    },
  }))
}
