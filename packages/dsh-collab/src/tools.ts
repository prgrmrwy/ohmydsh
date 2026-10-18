import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec, type InferArgs } from '@deepseek-ai/dsh-tools'
import { CollabError, type CommandContext, type CollabService } from 'collab-kernel'
import type { SessionAccess } from './session-provider.js'
import type { CollabHost } from './host.js'
const str = { type: 'string', required: true } as const
const integer = { type: 'integer', required: true } as const
const strings = { type: 'array', items: { type: 'string' }, required: true } as const
const common = { spaceId: str, cmdId: str }
const fields = { title: str, body: str, requiredAcks: strings, deciders: strings }

/** Do not send native error messages, stacks, data paths or raw locks to models. */
export function safeError(error: unknown) {
  if (!(error instanceof CollabError)) return { code: 'COLLAB_HOST_ERROR' }
  const { field, currentRevision, candidates, lock } = error.details
  return { code: error.code, details: { ...(field !== undefined ? { field } : {}), ...(currentRevision !== undefined ? { currentRevision } : {}), ...(candidates ? { candidates } : {}), ...(lock ? { lock: { instanceId: lock.instanceId, pid: lock.pid } } : {}) } }
}
export function collabTools(ctx: Context, access: SessionAccess, getHost: () => CollabHost | undefined) {
  const disposers: (() => void)[] = []
  const register = <S extends ParameterSchemaSpec>(name: string, parameters: S, write: boolean, run: (args: InferArgs<S>, service: CollabService, command: CommandContext) => Promise<unknown>) => {
    disposers.push(ctx.tools.register(defineTool({
      name, description: '已有会话协作台账；不授予额外权限。先读collab_read_convention；邀请不自动加入，投递仅表示入队接受。', parameters,
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        // DSH's implicit parameter root is open. Enforce this plugin's exact
        // allowlist before identity lookup, including reserved forged fields.
        if (Object.keys(args).some(key => !Object.hasOwn(parameters, key))) throw new CollabError('COLLAB_BAD_ARGUMENTS')
        const object = args as Record<string, unknown>
        if (write && (typeof object.cmdId !== 'string' || !object.cmdId.trim())) throw new CollabError('COLLAB_BAD_CMD_ID')
        try {
          const caller = access.caller(exec)
          const host = getHost()
          if (!host) throw new CollabError('COLLAB_SERVICE_NOT_READY')
          const spaceId = typeof object.spaceId === 'string' ? object.spaceId : ''
          const command = host.context(caller, spaceId, typeof object.cmdId === 'string' ? object.cmdId : undefined)
          const result = write
            ? await host.command(caller, spaceId, command.cmdId, service => run(args, service, command))
            : await host.read(caller, spaceId, service => run(args, service, command))
          return JSON.parse(JSON.stringify(result))
        } catch (error) { return { error: safeError(error) } }
      },
    })))
  }
  register('collab_create_space', { ...common, name: str }, true, (a, s, c) => s.createSpace(c, { name: a.name, address: c.principal.kind === 'agent' ? c.principal.address : '', kind: 'agent' }))
  register('collab_invite', { ...common, name: str, recipientSessionId: str }, true, (a, s, c) => s.invite(c, { name: a.name, address: a.recipientSessionId, kind: 'agent' }))
  register('collab_join', common, true, (_a, s, c) => s.join(c))
  register('collab_decline_invite', common, true, (_a, s, c) => s.declineInvite(c))
  register('collab_leave', common, true, (_a, s, c) => s.leave(c))
  register('collab_mark_gone', { ...common, member: str }, true, (a, s, c) => s.markGone(c, { member: a.member }))
  register('collab_transfer_leader', { ...common, member: str }, true, (a, s, c) => s.transferLeader(c, { member: a.member }))
  register('collab_close_space', common, true, (_a, s, c) => s.closeSpace(c))
  register('collab_create_item', { ...common, ...fields, itemId: str, kind: { type: 'string', enum: ['charter', 'other', 'request'], required: true }, assignee: { type: 'string' } } as const, true, (a, s, c) => {
    const input = { itemId: a.itemId, title: a.title, body: a.body, requiredAcks: a.requiredAcks, deciders: a.deciders }
    if (a.kind === 'request') {
      if (!a.assignee) throw new CollabError('COLLAB_BAD_ARGUMENTS')
      return s.createItem(c, { ...input, kind: 'request', assignee: a.assignee })
    }
    return s.createItem(c, { ...input, kind: a.kind })
  })
  register('collab_revise_item', { ...common, itemId: str, expectedRevision: integer, changes: { type: 'object', additionalProperties: false, required: true, properties: { title: { type: 'string' }, body: { type: 'string' }, requiredAcks: { type: 'array', items: { type: 'string' } }, deciders: { type: 'array', items: { type: 'string' } } } } } as const, true, (a, s, c) => s.reviseItem(c, { itemId: a.itemId, expectedRevision: a.expectedRevision, changes: a.changes }))
  register('collab_ack_item', { ...common, itemId: str, revision: integer }, true, (a, s, c) => s.ackItem(c, { itemId: a.itemId, revision: a.revision }))
  register('collab_send_message', { ...common, to: str, body: str, needsReply: { type: 'boolean' } } as const, true, (a, s, c) => s.sendMessage(c, { to: a.to, body: a.body, needsReply: a.needsReply }))
  register('collab_set_status', { ...common, text: str }, true, (a, s, c) => s.setStatus(c, { text: a.text }))
  register('collab_advance_request', { ...common, itemId: str, progress: { type: 'string', enum: ['open', 'accepted', 'done', 'rejected'], required: true } } as const, true, (a, s, c) => s.advanceRequest(c, { itemId: a.itemId, progress: a.progress }))
  register('collab_request_decision', { ...common, itemId: str, options: strings }, true, (a, s, c) => s.requestDecision(c, { itemId: a.itemId, options: a.options }))
  register('collab_overview', { spaceId: str }, false, (_a, s, c) => s.overview(c))
  register('collab_read_since', { spaceId: str, sinceSeq: integer }, false, (a, s, c) => s.readSince(c, a.sinceSeq))
  register('collab_project', { spaceId: str }, false, (_a, s, c) => s.project(c))
  register('collab_read_convention', { spaceId: str, version: str }, false, (a, s, c) => s.readConvention(c, a.version))
  register('collab_sessions', {}, false, () => access.discover())
  return () => { for (const dispose of disposers) dispose() }
}
