import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { CollabError, type CommandContext, type CollabService } from 'collab-kernel'
import type { SessionAccess } from './session-provider.js'
import type { CollabHost } from './host.js'
import { collabStatus } from './status.js'
import { prepareWrite, stampedRead, type WriteOp } from './stamp.js'
const S = { type: 'string' } as const
const str = { type: 'string', required: true } as const
const integer = { type: 'integer', required: true } as const
const strings = { type: 'array', items: { type: 'string' }, required: true } as const
const optStrings = { type: 'array', items: { type: 'string' } } as const
const ref = { type: 'integer' } as const
/** Copy optional fields only when present, unchanged: absent keys stay absent so payload hashes match. */
const pick = (a: Args, ...keys: string[]) => Object.fromEntries(keys.filter(k => a[k] !== undefined).map(k => [k, a[k]]))
const common = { spaceId: str, cmdId: str } as const

/** Codes that could reveal whether a space exists, who is in it, or its storage state. */
const UNAVAILABLE = new Set(['COLLAB_SPACE_NOT_FOUND', 'COLLAB_NOT_MEMBER'])
export const unavailable = (code: string) => UNAVAILABLE.has(code) || code.startsWith('COLLAB_STORE_')

/** Map kernel/Host errors for models: no native messages, paths, lock identity or space existence. */
export function safeError(error: unknown) {
  if (!(error instanceof CollabError)) return { code: 'COLLAB_HOST_ERROR' }
  if (unavailable(error.code)) return { code: 'COLLAB_SPACE_UNAVAILABLE' }
  // The caller went stale between entry and the kernel's commit/read boundary.
  if (error.code === 'COLLAB_CALLER_STALE') return { code: 'COLLAB_CALLER_UNAVAILABLE' }
  const { field, currentRevision, candidates } = error.details
  const details = { ...(field !== undefined ? { field } : {}), ...(currentRevision !== undefined ? { currentRevision } : {}), ...(candidates ? { candidates: [...candidates] } : {}) }
  return Object.keys(details).length ? { code: error.code, details } : { code: error.code }
}

type Args = Record<string, any>
type Run = (args: Args, service: CollabService, command: CommandContext) => Promise<unknown>
/** One closed enum value: the exact kernel method it maps to and its own fields. */
interface Variant { fields: readonly string[]; optional?: readonly string[]; run: Run }
interface Spec { description: string; parameters: ParameterSchemaSpec; kind: 'write' | 'read'; selector?: 'action' | 'view'; variants?: Record<string, Variant>; run?: Run }

export const STATUS_DESCRIPTION = '同机会话协作入口：先调用它查看你所在空间、待办与下一步建议。写命令返回 COLLAB_SPACE_UNAVAILABLE 时结果未知，稍后用原 cmdId 与相同参数重试。'
const self = (c: CommandContext) => c.principal.kind === 'agent' ? c.principal.address : ''

export const toolSpecs: Record<string, Spec> = {
  collab_space: {
    description: '创建或关闭协作空间（关闭需 Leader）；Leader 用 allow_manager/revoke_manager 授权或撤销接入方 channel 托管成员。', kind: 'write', selector: 'action',
    parameters: { action: { type: 'string', enum: ['create', 'close', 'allow_manager', 'revoke_manager'], required: true }, ...common, name: S, purpose: S, channel: S },
    variants: {
      create: { fields: ['name'], optional: ['purpose'], run: (a, s, c) => s.createSpace(c, { name: a.name, address: self(c), kind: 'agent', ...pick(a, 'purpose') }) },
      close: { fields: [], run: (_a, s, c) => s.closeSpace(c) },
      allow_manager: { fields: ['channel'], run: (a, s, c) => s.allowManager(c, { channel: a.channel }) },
      revoke_manager: { fields: ['channel'], run: (a, s, c) => s.revokeManager(c, { channel: a.channel }) },
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
    parameters: { ...common, itemId: str, kind: { type: 'string', enum: ['charter', 'other', 'request'], required: true }, title: str, body: str, requiredAcks: strings, assignee: S, ref, deciders: optStrings },
    run: (a, s, c) => {
      // Legacy `deciders` is forwarded untyped so pre-change retries hit their receipts; the kernel refuses it otherwise.
      const input = { itemId: a.itemId, title: a.title, body: a.body, requiredAcks: a.requiredAcks, ...pick(a, 'deciders', 'ref', 'ext') } as any
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
    description: '发消息；notify 控制唤醒（未填沿用 needsReply），needsReply 控制要求回复。结果需对方继续时 notify=true、needsReply=false。接续同一件事时 ref 填相关消息或条目的 seq，另起一件事不填。', kind: 'write',
    parameters: { ...common, to: str, body: str, needsReply: { type: 'boolean' }, notify: { type: 'boolean' }, ref },
    run: (a, s, c) => s.sendMessage(c, { to: a.to, body: a.body, needsReply: a.needsReply, ...pick(a, 'notify', 'ref', 'ext') }),
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
}
/** Member write tools a stamped caller may run; `ext` is set by the plugin, never by the model. */
const WRITE_OPS: Readonly<Record<string, WriteOp>> = { collab_create_item: 'createItem', collab_revise_item: 'reviseItem', collab_ack_item: 'ackItem', collab_send_message: 'sendMessage', collab_set_status: 'setStatus', collab_advance_request: 'advanceRequest' }
/** Reserved cmdId: addresses are never reused in a space, so one join per member; retries replay its receipt. */
export const AUTO_JOIN_CMD_ID = 'dsh-collab:auto-join'
/**
 * Member trust: after a successful invite, the Host joins on behalf of the
 * invitee it just claimed (Host-vouched identity; never a model-chosen address
 * beyond the invite target). Failure leaves the invite as is.
 */
async function autoJoin(host: CollabHost, access: SessionAccess, spaceId: string, address: string): Promise<boolean> {
  // A replayed invite may name a session that has since lost admission.
  if (typeof address !== 'string' || !access.admissible(address)) return false
  try {
    const command = host.context(address, spaceId, AUTO_JOIN_CMD_ID)
    await host.command(address, spaceId, AUTO_JOIN_CMD_ID, service => service.join(command))
    return true
  } catch { return false }
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
      const out = JSON.parse(JSON.stringify(await collabStatus(host, access, caller, typeof object.spaceId === 'string' ? object.spaceId : undefined)))
      // Status reads through host-index, so the kernel never sees this caller's
      // guard: re-run every entry condition after the last await, before returning.
      if (!caller.guard()) throw new CollabError('COLLAB_CALLER_UNAVAILABLE')
      return out
    } catch (error) { return { error: safeError(error) } }
  })
  for (const [name, spec] of Object.entries(toolSpecs)) {
    const variantFields = new Set(Object.values(spec.variants ?? {}).flatMap(v => [...v.fields, ...(v.optional ?? [])]))
    register(name, spec.description, spec.parameters, async (object, exec) => {
      let run = spec.run
      if (spec.selector) {
        const value = object[spec.selector]
        const variant = typeof value === 'string' && Object.hasOwn(spec.variants!, value) ? spec.variants![value]! : undefined
        // Closed enum: each value needs exactly its own fields, never another value's.
        if (!variant || variant.fields.some(f => object[f] === undefined) || [...variantFields].some(f => object[f] !== undefined && !variant.fields.includes(f) && !variant.optional?.includes(f))) throw new CollabError('COLLAB_BAD_ARGUMENTS')
        run = variant.run
      }
      if (spec.kind === 'write' && (typeof object.cmdId !== 'string' || !object.cmdId.trim())) throw new CollabError('COLLAB_BAD_CMD_ID')
      const spaceId = typeof object.spaceId === 'string' ? object.spaceId : ''
      try {
        const caller = access.caller(exec)
        const host = getHost()
        if (!host) throw new CollabError('COLLAB_SERVICE_NOT_READY')
        let result: unknown
        if (spec.kind === 'write') {
          // Stamped managed callers: recipients, write-target checks, ext and cmdId namespace (design D3).
          const op = WRITE_OPS[name]
          const prepared = op ? await prepareWrite(host, caller, spaceId, object.cmdId, op, object) : { caller, cmdId: object.cmdId as string, input: object }
          if ('error' in prepared) throw new CollabError(prepared.error)
          const command = host.context(prepared.caller, spaceId, prepared.cmdId)
          result = await host.command(prepared.caller, spaceId, command.cmdId, service => run!(prepared.input, service, command))
        } else {
          const command = host.context(caller, spaceId)
          result = await host.read(caller, spaceId, service => (name === 'collab_read' && (object.view === 'overview' || object.view === 'since') ? stampedRead(host, service, command, caller, object.view, object.sinceSeq) : undefined) ?? run!(object, service, command))
        }
        if (spec.kind === 'read' && !caller.guard()) throw new CollabError('COLLAB_CALLER_UNAVAILABLE')
        if (name === 'collab_invite' && access.policy?.memberTrust === true) return { ...JSON.parse(JSON.stringify(result)), autoJoined: await autoJoin(host, access, spaceId, object.recipientSessionId) }
        return JSON.parse(JSON.stringify(result))
      } catch (error) { log(spaceId, error); return { error: safeError(error) } }
    })
  }
  return () => { for (const dispose of disposers) dispose() }
}
