import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { CollabError, type CommandContext, type CollabService } from 'collab-kernel'
import type { SessionAccess } from './session-provider.js'
import type { CollabHost } from './host.js'
import { collabStatus } from './status.js'
const S = { type: 'string' } as const
const str = { type: 'string', required: true } as const
const integer = { type: 'integer', required: true } as const
const strings = { type: 'array', items: { type: 'string' }, required: true } as const
const common = { spaceId: str, cmdId: str } as const

/** Codes that could reveal whether a space exists, who is in it, or its storage state. */
const UNAVAILABLE = new Set(['COLLAB_SPACE_NOT_FOUND', 'COLLAB_NOT_MEMBER'])
export const unavailable = (code: string) => UNAVAILABLE.has(code) || code.startsWith('COLLAB_STORE_')

/** Map kernel/Host errors for models: no native messages, paths, lock identity or space existence. */
export function safeError(error: unknown) {
  if (!(error instanceof CollabError)) return { code: 'COLLAB_HOST_ERROR' }
  if (unavailable(error.code)) return { code: 'COLLAB_SPACE_UNAVAILABLE' }
  const { field, currentRevision, candidates } = error.details
  const details = { ...(field !== undefined ? { field } : {}), ...(currentRevision !== undefined ? { currentRevision } : {}), ...(candidates ? { candidates: [...candidates] } : {}) }
  return Object.keys(details).length ? { code: error.code, details } : { code: error.code }
}

type Args = Record<string, any>
type Run = (args: Args, service: CollabService, command: CommandContext) => Promise<unknown>
/** One closed enum value: the exact kernel method it maps to and its own fields. */
interface Variant { fields: readonly string[]; run: Run }
interface Spec { description: string; parameters: ParameterSchemaSpec; kind: 'write' | 'read'; selector?: 'action' | 'view'; variants?: Record<string, Variant>; run?: Run }

export const STATUS_DESCRIPTION = '同机会话协作入口：先调用它查看你所在空间、待办与下一步建议。写命令返回 COLLAB_SPACE_UNAVAILABLE 时结果未知，稍后用原 cmdId 与相同参数重试。'
const self = (c: CommandContext) => c.principal.kind === 'agent' ? c.principal.address : ''

export const toolSpecs: Record<string, Spec> = {
  collab_space: {
    description: '创建或关闭协作空间（关闭需 Leader）。', kind: 'write', selector: 'action',
    parameters: { action: { type: 'string', enum: ['create', 'close'], required: true }, ...common, name: S },
    variants: {
      create: { fields: ['name'], run: (a, s, c) => s.createSpace(c, { name: a.name, address: self(c), kind: 'agent' }) },
      close: { fields: [], run: (_a, s, c) => s.closeSpace(c) },
    },
  },
  collab_invite: {
    description: '用完整 session ID 邀请会话加入（Leader）。', kind: 'write',
    parameters: { ...common, name: str, recipientSessionId: str },
    run: (a, s, c) => s.invite(c, { name: a.name, address: a.recipientSessionId, kind: 'agent' }),
  },
  collab_member: {
    description: '成员操作：join、decline、leave；Leader 的 mark_gone、transfer_leader 需 member。', kind: 'write', selector: 'action',
    parameters: { action: { type: 'string', enum: ['join', 'decline', 'leave', 'mark_gone', 'transfer_leader'], required: true }, ...common, member: S },
    variants: {
      join: { fields: [], run: (_a, s, c) => s.join(c) },
      decline: { fields: [], run: (_a, s, c) => s.declineInvite(c) },
      leave: { fields: [], run: (_a, s, c) => s.leave(c) },
      mark_gone: { fields: ['member'], run: (a, s, c) => s.markGone(c, { member: a.member }) },
      transfer_leader: { fields: ['member'], run: (a, s, c) => s.transferLeader(c, { member: a.member }) },
    },
  },
  collab_read: {
    description: '读取空间：overview、since(sinceSeq)、convention(version)。空间 lastSeq 小于你保存的游标时，从 0 重读。', kind: 'read', selector: 'view',
    parameters: { view: { type: 'string', enum: ['overview', 'since', 'convention'], required: true }, spaceId: str, sinceSeq: { type: 'integer' }, version: S },
    variants: {
      overview: { fields: [], run: (_a, s, c) => s.overview(c) },
      since: { fields: ['sinceSeq'], run: (a, s, c) => s.readSince(c, a.sinceSeq) },
      convention: { fields: ['version'], run: (a, s, c) => s.readConvention(c, a.version) },
    },
  },
  collab_create_item: {
    description: '创建条目；itemId 用小写字母、数字与连字符；request 需 assignee。', kind: 'write',
    parameters: { ...common, itemId: str, kind: { type: 'string', enum: ['charter', 'other', 'request'], required: true }, title: str, body: str, requiredAcks: strings, deciders: strings, assignee: S },
    run: (a, s, c) => {
      const input = { itemId: a.itemId, title: a.title, body: a.body, requiredAcks: a.requiredAcks, deciders: a.deciders }
      if (a.kind === 'request') {
        if (!a.assignee) throw new CollabError('COLLAB_BAD_ARGUMENTS')
        return s.createItem(c, { ...input, kind: 'request', assignee: a.assignee })
      }
      return s.createItem(c, { ...input, kind: a.kind })
    },
  },
  collab_revise_item: {
    description: '按 expectedRevision 修改条目。', kind: 'write',
    parameters: { ...common, itemId: str, expectedRevision: integer, changes: { type: 'object', additionalProperties: false, required: true, properties: { title: S, body: S, requiredAcks: { type: 'array', items: S }, deciders: { type: 'array', items: S } } } },
    run: (a, s, c) => s.reviseItem(c, { itemId: a.itemId, expectedRevision: a.expectedRevision, changes: a.changes }),
  },
  collab_ack_item: {
    description: '确认条目的当前 revision。', kind: 'write',
    parameters: { ...common, itemId: str, revision: integer },
    run: (a, s, c) => s.ackItem(c, { itemId: a.itemId, revision: a.revision }),
  },
  collab_send_message: {
    description: '发消息；只有需要对方接续时 needsReply=true。', kind: 'write',
    parameters: { ...common, to: str, body: str, needsReply: { type: 'boolean' } },
    run: (a, s, c) => s.sendMessage(c, { to: a.to, body: a.body, needsReply: a.needsReply }),
  },
  collab_set_status: {
    description: '更新自己的状态文本，不唤醒他人。', kind: 'write',
    parameters: { ...common, text: str },
    run: (a, s, c) => s.setStatus(c, { text: a.text }),
  },
  collab_advance_request: {
    description: '承接方推进 request。', kind: 'write',
    parameters: { ...common, itemId: str, progress: { type: 'string', enum: ['open', 'accepted', 'done', 'rejected'], required: true } },
    run: (a, s, c) => s.advanceRequest(c, { itemId: a.itemId, progress: a.progress }),
  },
  collab_request_decision: {
    description: '请人决定，给 2–8 个选项。', kind: 'write',
    parameters: { ...common, itemId: str, options: strings },
    run: (a, s, c) => s.requestDecision(c, { itemId: a.itemId, options: a.options }),
  },
}
const OUTPUT = { schema: { type: 'json' }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] } as const

export function collabTools(ctx: Context, access: SessionAccess, getHost: () => CollabHost | undefined) {
  const disposers: (() => void)[] = []
  const log = (spaceId: string, error: unknown) => {
    // Storage diagnostics (lock identity included) belong to the trusted Host log only.
    if (error instanceof CollabError && error.code.startsWith('COLLAB_STORE_')) {
      try { ctx.logger?.('dsh-collab')?.warn('space %s unavailable: %s instanceId=%s pid=%s', spaceId, error.code, error.details.lock?.instanceId ?? '-', error.details.lock?.pid ?? '-') } catch {}
    }
  }
  const register = (name: string, description: string, parameters: ParameterSchemaSpec, body: (object: Args, exec: any) => Promise<unknown>) => {
    const tool = defineTool({
      name, description, parameters, output: OUTPUT,
      async execute(args, exec): Promise<any> {
        // DSH's implicit parameter root is open. Enforce this plugin's exact
        // allowlist before identity lookup, including reserved forged fields.
        if (Object.keys(args).some(key => !Object.hasOwn(parameters, key))) throw new CollabError('COLLAB_BAD_ARGUMENTS')
        return body(args as Args, exec)
      },
    })
    const dispose = ctx.tools.register(tool)
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  register('collab_status', STATUS_DESCRIPTION, { spaceId: S }, async (object, exec) => {
    try {
      const caller = access.caller(exec)
      const host = getHost()
      if (!host) throw new CollabError('COLLAB_SERVICE_NOT_READY')
      return JSON.parse(JSON.stringify(await collabStatus(host, access, caller, typeof object.spaceId === 'string' ? object.spaceId : undefined)))
    } catch (error) { return { error: safeError(error) } }
  })
  for (const [name, spec] of Object.entries(toolSpecs)) {
    const variantFields = new Set(Object.values(spec.variants ?? {}).flatMap(v => v.fields))
    register(name, spec.description, spec.parameters, async (object, exec) => {
      let run = spec.run
      if (spec.selector) {
        const value = object[spec.selector]
        const variant = typeof value === 'string' && Object.hasOwn(spec.variants!, value) ? spec.variants![value]! : undefined
        // Closed enum: each value needs exactly its own fields, never another value's.
        if (!variant || variant.fields.some(f => object[f] === undefined) || [...variantFields].some(f => object[f] !== undefined && !variant.fields.includes(f))) throw new CollabError('COLLAB_BAD_ARGUMENTS')
        run = variant.run
      }
      if (spec.kind === 'write' && (typeof object.cmdId !== 'string' || !object.cmdId.trim())) throw new CollabError('COLLAB_BAD_CMD_ID')
      const spaceId = typeof object.spaceId === 'string' ? object.spaceId : ''
      try {
        const caller = access.caller(exec)
        const host = getHost()
        if (!host) throw new CollabError('COLLAB_SERVICE_NOT_READY')
        const command = host.context(caller, spaceId, typeof object.cmdId === 'string' ? object.cmdId : undefined)
        const result = spec.kind === 'write'
          ? await host.command(caller, spaceId, command.cmdId, service => run!(object, service, command))
          : await host.read(caller, spaceId, service => run!(object, service, command))
        return JSON.parse(JSON.stringify(result))
      } catch (error) { log(spaceId, error); return { error: safeError(error) } }
    })
  }
  return () => { for (const dispose of disposers) dispose() }
}
