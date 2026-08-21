import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute } from 'node:path'
import type { OperationRecord, SourceBindingRequest, StartOperationRequest, WireEnvelope } from '../wire.js'
import { ROUTES } from '../wire.js'
import { wireError, WsError } from './errors.js'
import { createGitClient, discoverRepo, listRefs, listWorktrees } from './git.js'
import { bindSource, findBySourceSession, loadOperation, sessionStatus, startOperation, updateSourceBinding } from './operation.js'
import { wsClean, wsPromote, wsStatus } from './maintenance.js'

const BODY_LIMIT = 64 * 1024

export interface RouteRegistration {
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

function send<T>(res: ServerResponse, status: number, body: WireEnvelope<T>): void {
  const encoded = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(encoded),
  })
  res.end(encoded)
}

function trusted(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').toLowerCase()
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') return false
  const origin = req.headers.origin
  if (origin === undefined || origin === 'null') return true
  try {
    const originHost = new URL(origin).hostname.toLowerCase()
    return originHost === hostname || (originHost === 'localhost' && hostname === '127.0.0.1') || (originHost === '127.0.0.1' && hostname === 'localhost')
  } catch { return false }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new WsError('BODY_TOO_LARGE', 'Request body is too large')
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) { rejectPromise(new WsError('BODY_TOO_LARGE', 'Request body is too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { rejectPromise(new WsError('INVALID_REQUEST', 'Request body must be valid JSON')) }
    })
    req.on('error', rejectPromise)
  })
}

function strictObject(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new WsError('INVALID_REQUEST', 'Request body must be an object')
  const record = body as Record<string, unknown>
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new WsError('INVALID_REQUEST', `Unknown body key ${key}`)
  for (const key of keys) if (!(key in record)) throw new WsError('INVALID_REQUEST', `Missing body key ${key}`)
  return record
}

function stringField(record: Record<string, unknown>, key: string): string {
  if (typeof record[key] !== 'string' || record[key].trim() === '') throw new WsError('INVALID_REQUEST', `${key} must be a non-empty string`)
  return record[key]
}

function absolutePath(record: Record<string, unknown>, key: string): string {
  const value = stringField(record, key)
  if (!isAbsolute(value)) throw new WsError('INVALID_REQUEST', `${key} must be absolute`)
  return value
}

function maintenanceTarget(body: unknown): { path: string } | { sessionId: string; repoPath: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new WsError('INVALID_REQUEST', 'Request body must be an object')
  const record = body as Record<string, unknown>
  const keys = Object.keys(record).sort()
  for (const key of keys) if (key !== 'path' && key !== 'repoPath' && key !== 'sessionId') throw new WsError('INVALID_REQUEST', `Unknown body key ${key}`)
  if (keys.length === 1 && keys[0] === 'path') return { path: absolutePath(record, 'path') }
  if (keys.length === 2 && keys[0] === 'repoPath' && keys[1] === 'sessionId') return { sessionId: stringField(record, 'sessionId'), repoPath: absolutePath(record, 'repoPath') }
  throw new WsError('INVALID_REQUEST', 'Provide exactly path, or sessionId + repoPath')
}

function route<T>(path: string, action: (body: unknown) => Promise<T>): RouteRegistration {
  return {
    path,
    async handler(req, res) {
      try {
        if (!trusted(req)) throw new WsError('UNTRUSTED_REQUEST', 'Untrusted Host or Origin')
        if (req.method !== 'POST') throw new WsError('METHOD_NOT_ALLOWED', 'Only POST is supported')
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new WsError('INVALID_REQUEST', 'Content-Type must be application/json')
        send(res, 200, { ok: true, data: await action(await readBody(req)) })
      } catch (error) {
        const wire = wireError(error)
        const status = wire.code === 'UNTRUSTED_REQUEST' ? 403 : wire.code === 'METHOD_NOT_ALLOWED' ? 405 : wire.code === 'BODY_TOO_LARGE' ? 413 : wire.code.endsWith('_NOT_FOUND') ? 404 : wire.code === 'OPERATION_CONFLICT' ? 409 : wire.code === 'INTERNAL_ERROR' ? 500 : 400
        send(res, status, { ok: false, error: wire })
      }
    },
  }
}

export interface HostRouteDeps {
  activeSessionPaths?: () => readonly string[]
  activeBoundSessionIds?: () => readonly string[]
  /** Validate the source Session against the durable operation and synchronously install scoped policy. */
  bindLiveSource?: (sourceSessionId: string, operation: OperationRecord, options: { requireBlank: boolean }) => void
  /** Refresh an already-bound live Session after Host restart/UI resume. */
  recordBind?: (sourceSessionId: string, operation: OperationRecord | undefined) => void
  /** Reconcile archive lifecycle before deciding whether a current binding exists. */
  reconcileSession?: (sourceSessionId: string) => Promise<void>
}

async function loadBySession(repoPath: string, sourceSessionId: string): Promise<OperationRecord | undefined> {
  const repo = await discoverRepo(repoPath)
  return findBySourceSession(repo.gitCommonDir, sourceSessionId)
}

export function createRoutes(deps: HostRouteDeps = {}): readonly RouteRegistration[] {
  const recordBind = (sourceSessionId: string, operation: OperationRecord | undefined): void => deps.recordBind?.(sourceSessionId, operation)
  return [
    route(ROUTES.repoStatus, async body => {
      const parsed = strictObject(body, ['repoPath'])
      const repoPath = absolutePath(parsed, 'repoPath')
      const git = createGitClient()
      const repo = await discoverRepo(repoPath, git)
      return { repo: true as const, ...repo, refs: await listRefs(repo.repoRoot, git), worktrees: await listWorktrees(repo.repoRoot, git) }
    }),
    route(ROUTES.start, async body => {
      const parsed = strictObject(body, ['operationId', 'repoPath', 'baseRef', 'taskText', 'dependencyMode'])
      const request: StartOperationRequest = {
        operationId: stringField(parsed, 'operationId'),
        repoPath: absolutePath(parsed, 'repoPath'),
        baseRef: stringField(parsed, 'baseRef'),
        taskText: stringField(parsed, 'taskText'),
        dependencyMode: parsed.dependencyMode === 'lean' ? 'lean' : (() => { throw new WsError('INVALID_REQUEST', 'dependencyMode must be lean') })(),
      }
      return startOperation(request)
    }),
    route(ROUTES.operationStatus, async body => {
      const parsed = strictObject(body, ['operationId', 'repoPath'])
      const repo = await discoverRepo(absolutePath(parsed, 'repoPath'))
      const operation = await loadOperation(repo.gitCommonDir, stringField(parsed, 'operationId'))
      if (operation === undefined) throw new WsError('OPERATION_NOT_FOUND', 'Operation not found')
      return operation
    }),
    route(ROUTES.bindSource, async body => {
      const parsed = strictObject(body, ['operationId', 'repoPath', 'sourceSessionId', 'action'])
      if (parsed.action !== 'bind-source' && parsed.action !== 'claim-submit' && parsed.action !== 'admitted' && parsed.action !== 'uncertain' && parsed.action !== 'cleaned') throw new WsError('INVALID_REQUEST', 'Invalid source binding action')
      const request: SourceBindingRequest = {
        operationId: stringField(parsed, 'operationId'),
        repoPath: absolutePath(parsed, 'repoPath'),
        sourceSessionId: stringField(parsed, 'sourceSessionId'),
        action: parsed.action,
      }
      if (request.action === 'bind-source') {
        const repo = await discoverRepo(request.repoPath)
        const operation = await loadOperation(repo.gitCommonDir, request.operationId)
        if (operation === undefined) throw new WsError('OPERATION_NOT_FOUND', 'Prepared operation not found')
        deps.bindLiveSource?.(request.sourceSessionId, operation, { requireBlank: true })
        const result = await bindSource(request)
        recordBind(request.sourceSessionId, await loadBySession(request.repoPath, request.sourceSessionId))
        return result
      }
      const current = await loadBySession(request.repoPath, request.sourceSessionId)
      if (current === undefined) throw new WsError('OPERATION_NOT_FOUND', 'Source Session binding not found')
      // Claim is admitted only after the exact live Agent policy has been reinstalled.
      if (request.action === 'claim-submit') deps.bindLiveSource?.(request.sourceSessionId, current, { requireBlank: true })
      const result = await updateSourceBinding(request)
      recordBind(request.sourceSessionId, await loadBySession(request.repoPath, request.sourceSessionId))
      return result
    }),
    route(ROUTES.sessionStatus, async body => {
      const parsed = strictObject(body, ['sessionId', 'repoPath'])
      const repoPath = absolutePath(parsed, 'repoPath')
      const sourceSessionId = stringField(parsed, 'sessionId')
      await deps.reconcileSession?.(sourceSessionId)
      const result = await sessionStatus(repoPath, sourceSessionId)
      if (result.bound) recordBind(sourceSessionId, await loadBySession(repoPath, sourceSessionId))
      else recordBind(sourceSessionId, undefined)
      return result
    }),
    route(ROUTES.status, async body => wsStatus(maintenanceTarget(body))),
    route(ROUTES.promote, async body => {
      const target = maintenanceTarget(body)
      const result = await wsPromote(target)
      if ('sessionId' in target) recordBind(target.sessionId, await loadBySession(target.repoPath, target.sessionId))
      return result
    }),
    route(ROUTES.clean, async body => {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new WsError('INVALID_REQUEST', 'Request body must be an object')
      const { dryRun, ...targetBody } = body as Record<string, unknown>
      if (typeof dryRun !== 'boolean') throw new WsError('INVALID_REQUEST', 'dryRun must be boolean')
      const target = maintenanceTarget(targetBody)
      const activePaths = deps.activeSessionPaths?.()
      const activeBoundSessionIds = deps.activeBoundSessionIds?.()
      const result = await wsClean(target, { dryRun, requireActivePaths: true, ...(activePaths === undefined ? {} : { activePaths }), ...(activeBoundSessionIds === undefined ? {} : { activeBoundSessionIds }) })
      if (!dryRun && 'sessionId' in target) recordBind(target.sessionId, await loadBySession(target.repoPath, target.sessionId))
      return result
    }),
  ]
}
