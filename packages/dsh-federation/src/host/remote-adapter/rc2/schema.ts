export interface Rc2RpcSuccess<T> {
  readonly type: 'server-response'
  readonly rpcId: string
  readonly result: { readonly ok: true; readonly value: T }
}

export interface Rc2RpcFailure {
  readonly type: 'server-response'
  readonly rpcId: string
  readonly result: { readonly ok: false; readonly error: unknown }
}

export type Rc2RpcResponse<T> = Rc2RpcSuccess<T> | Rc2RpcFailure

export interface Rc2HostDescription {
  readonly version: string
  readonly cwd: string
  readonly home: string
  readonly attachedSessions: number
  readonly canOpenPath: boolean
}

export interface Rc2Workspace {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

export interface Rc2Session {
  readonly sessionId: string
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly cwd?: string
  readonly projections?: { readonly asOfSeq: number; readonly values: Readonly<Record<string, unknown>> }
}

export interface Rc2WorkspaceList {
  readonly items: readonly Rc2Workspace[]
  readonly archivedSessionIds: readonly string[]
}

export interface Rc2SessionList {
  readonly items: readonly Rc2Session[]
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

export function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

export function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

export function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

export function hostDescription(value: unknown): Rc2HostDescription {
  const record = object(value, 'host.describe')
  return {
    version: string(record.version, 'host.describe.version'),
    cwd: string(record.cwd, 'host.describe.cwd'),
    home: string(record.home, 'host.describe.home'),
    attachedSessions: number(record.attachedSessions, 'host.describe.attachedSessions'),
    canOpenPath: boolean(record.canOpenPath, 'host.describe.canOpenPath'),
  }
}

function workspace(value: unknown): Rc2Workspace {
  const record = object(value, 'workspace')
  return {
    workspaceId: string(record.workspaceId, 'workspace.workspaceId'),
    title: string(record.title, 'workspace.title'),
    path: string(record.path, 'workspace.path'),
    sessionIds: array(record.sessionIds, 'workspace.sessionIds').map((item, index) => string(item, `workspace.sessionIds[${index}]`)),
  }
}

export function workspaceList(value: unknown): Rc2WorkspaceList {
  const record = object(value, 'workspace.list')
  return {
    items: array(record.items, 'workspace.list.items').map(workspace),
    archivedSessionIds: array(record.archivedSessionIds ?? [], 'workspace.list.archivedSessionIds').map((item, index) => string(item, `archivedSessionIds[${index}]`)),
  }
}

function session(value: unknown): Rc2Session {
  const record = object(value, 'session')
  let projections: Rc2Session['projections']
  if (record.projections !== undefined) {
    const block = object(record.projections, 'session.projections')
    projections = {
      asOfSeq: number(block.asOfSeq, 'session.projections.asOfSeq'),
      values: object(block.values, 'session.projections.values'),
    }
  }
  return {
    sessionId: string(record.sessionId, 'session.sessionId'),
    updatedAt: number(record.updatedAt, 'session.updatedAt'),
    running: boolean(record.running, 'session.running'),
    blank: boolean(record.blank, 'session.blank'),
    ...(record.cwd === undefined ? {} : { cwd: string(record.cwd, 'session.cwd') }),
    ...(projections === undefined ? {} : { projections }),
  }
}

export function sessionList(value: unknown): Rc2SessionList {
  const record = object(value, 'session.list')
  return { items: array(record.items, 'session.list.items').map(session) }
}

export function workspaceValue(value: unknown, label: string): Rc2Workspace {
  return workspace(value === undefined ? value : object(value, label).workspace)
}

export function trueReceipt(value: unknown, label: string, key: 'accepted' | 'deleted' = 'accepted'): void {
  if (object(value, label)[key] !== true) throw new Error(`${label}.${key} must be true`)
}

export function stringListValue(value: unknown, label: string, key: string): readonly string[] {
  return array(object(value, label)[key], `${label}.${key}`).map((item, index) => string(item, `${label}.${key}[${index}]`))
}

export function sessionIdValue(value: unknown, label: string): string {
  return string(object(value, label).sessionId, `${label}.sessionId`)
}

export function renameValue(value: unknown): { readonly title: string; readonly seq: number } {
  const record = object(value, 'session.rename')
  return { title: string(record.title, 'session.rename.title'), seq: number(record.seq, 'session.rename.seq') }
}

export function historyValue(value: unknown): unknown {
  const record = object(value, 'session.history')
  array(record.events, 'session.history.events')
  boolean(record.hasMore, 'session.history.hasMore')
  if (record.projections !== undefined) {
    const projections = object(record.projections, 'session.history.projections')
    number(projections.asOfSeq, 'session.history.projections.asOfSeq')
    object(projections.values, 'session.history.projections.values')
  }
  return value
}

export function modelsValue(value: unknown): unknown {
  const record = object(value, 'session.models')
  object(record.current, 'session.models.current')
  boolean(record.routable, 'session.models.routable')
  array(record.groups, 'session.models.groups')
  array(record.failures, 'session.models.failures')
  return value
}

export function selectedModelValue(value: unknown): unknown {
  return object(object(value, 'session.selectModel').selected, 'session.selectModel.selected')
}

export function attachmentValue(value: unknown): unknown {
  const record = object(value, 'session.attachment')
  object(record.attachment, 'session.attachment.attachment')
  string(record.data, 'session.attachment.data')
  return value
}

export interface Rc2SearchValue {
  readonly items: readonly { readonly sessionId: string; readonly snippet: string }[]
  readonly hasMore: boolean
}

export function searchValue(value: unknown): Rc2SearchValue {
  const record = object(value, 'session.search')
  return {
    items: array(record.items, 'session.search.items').map(item => {
      const row = object(item, 'session.search.item')
      return { sessionId: string(row.sessionId, 'session.search.sessionId'), snippet: string(row.snippet, 'session.search.snippet') }
    }),
    hasMore: boolean(record.hasMore, 'session.search.hasMore'),
  }
}

export function directoryListingValue(value: unknown): unknown {
  const record = object(value, 'host.listDirectory')
  string(record.path, 'host.listDirectory.path')
  string(record.home, 'host.listDirectory.home')
  array(record.crumbs, 'host.listDirectory.crumbs')
  array(record.entries, 'host.listDirectory.entries')
  boolean(record.truncated, 'host.listDirectory.truncated')
  return value
}

export function directoryCreatedValue(value: unknown): unknown {
  string(object(value, 'host.createDirectory').path, 'host.createDirectory.path')
  return value
}
