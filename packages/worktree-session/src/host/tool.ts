import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MaintenanceTarget } from './maintenance.js'
import { wsClean, wsPromote, wsStatus } from './maintenance.js'

export function targetFor(args: object & { path?: string }, exec: { agent?: { session: { id: unknown; header: { cwd?: string } } } }): MaintenanceTarget | string {
  const agent = exec.agent
  // Older model/tool clients sometimes materialize an omitted optional string as
  // `""`. Treat that wire artefact as absent so a bound call still resolves by
  // Session identity; every non-empty explicit path remains forbidden to Agents.
  if (args.path !== undefined && args.path !== '') {
    if (agent !== undefined) throw new Error('ws explicit path is unavailable to an Agent-bound call; use the Session binding or the path-oriented dsh-ws CLI')
    return args.path
  }
  const repoPath = agent?.session.header.cwd
  if (agent === undefined || repoPath === undefined) throw new Error('ws requires a calling Session binding or an explicit operator recovery path')
  return { sessionId: String(agent.session.id), repoPath }
}

/** Agent-visible arguments deliberately exclude operator-only path targeting. */
export const WS_TOOL_PARAMETERS = {
  action: { type: 'string', required: true, enum: ['status', 'promote', 'clean'] as const, description: 'Maintenance action for the exact calling Session binding.' },
  dry_run: { type: 'boolean', description: 'For clean only, preview the safety-proven actions without removing resources.' },
} as const

/** Register the Session-oriented maintenance tool. */
export function registerWsTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'ws',
    description: 'Inspect or promote the exact current Worktree Session binding. Clean applies the active/dirty/merge safety gates. Path-oriented operator recovery is available only through dsh-ws or the Skill shell wrapper.',
    parameters: WS_TOOL_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(args, exec) {
      const target = targetFor(args, exec)
      const result = args.action === 'status'
        ? await wsStatus(target)
        : args.action === 'promote'
          ? await wsPromote(target)
          : await wsClean(target, {
              dryRun: args.dry_run ?? false,
              activePaths: ctx.sessions.list().flatMap(session => session.header.cwd === undefined ? [] : [session.header.cwd]),
              requireActivePaths: true,
              activeBoundSessionIds: ctx.agents.list().map(agent => String(agent.session.id)),
            })
      return { json: JSON.stringify(result, null, 2) }
    },
  }))
}
