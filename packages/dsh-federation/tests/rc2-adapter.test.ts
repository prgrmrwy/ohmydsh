import { beforeAll, describe, expect, it, vi } from 'vitest'
import { parseNodeId, type NodeCapability, type NodeDescriptor, type RpcId } from '../src/core/index.js'
import { CarrierError, DshRc2NodeAdapter, DualEventCarrier, HttpUnaryCarrier, RC2_ALLOWED_METHODS, RC2_FORBIDDEN_METHODS, RemoteBusinessError, validateRc2EventEnvelope, type CarrierSocket, type DualStreamReadiness } from '../src/host/index.js'

const nodeId = parseNodeId('vm-a')
const full = new Set<NodeCapability>([
  'workspace.read', 'workspace.write', 'session.read', 'session.write', 'session.search',
  'session.attachment', 'directory.read', 'directory.write', 'events.mux', 'events.host', 'interaction.respond',
])
let streamProof: DualStreamReadiness

class OpeningSocket implements CarrierSocket {
  readonly readyState = 1
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (() => void)): void {
    if (type === 'open') queueMicrotask(listener)
  }
  close(): void {}
}

async function streamReadiness(): Promise<DualStreamReadiness> {
  const carrier = new DualEventCarrier({
    endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
    createSocket: () => new OpeningSocket(), validate: (_stream, value) => value,
    onFrame() {}, onDisconnect() {},
  })
  return carrier.open()
}

const workspaceView = (workspaceId: string, title: string, path: string, sessionIds: string[]) => ({
  workspaceId, title, path, sessionIds,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
})

const descriptor: NodeDescriptor = {
  nodeId, kind: 'remote', displayName: 'VM A', enabled: true, order: 0,
  capabilities: full, compatibility: 'SUPPORTED', state: 'READY', sshAlias: 'vm-a', remoteDshPort: 3080,
}

function success(rpcId: string, value: unknown) {
  return new Response(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
}
function carrier(handler: (method: string, envelope: Record<string, unknown>, signal?: AbortSignal) => Response | Promise<Response>) {
  return new HttpUnaryCarrier({
    endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
    fetch: (async (url, init) => {
      const envelope = JSON.parse(String(init?.body)) as Record<string, unknown>
      return handler(new URL(url).pathname.slice('/api/'.length), envelope, init?.signal ?? undefined)
    }) as typeof globalThis.fetch,
  })
}

function probeCarrier(version: string, failMethod?: string) {
  return carrier((method, request) => {
    if (method === failMethod) return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { code: 'unsupported' } } }))
    if (method === 'host.describe') return success(request.rpcId as string, { version, cwd: '/fixture', home: '/fixture', attachedSessions: 0, canOpenPath: false, unknown: 'ignored' })
    if (method === 'workspace.list') return success(request.rpcId as string, { items: [], archivedSessionIds: [] })
    if (method === 'session.list') return success(request.rpcId as string, { items: [] })
    if (method === 'session.search') return success(request.rpcId as string, { items: [], hasMore: false })
    if (method === 'host.listDirectory') return success(request.rpcId as string, { path: '/fixture', home: '/fixture', crumbs: [], entries: [], truncated: false })
    throw new Error(`unexpected probe method ${method}`)
  })
}

describe('rc.2 capability probe', () => {
  beforeAll(async () => { streamProof = await streamReadiness() })

  it('grants writes on structural proof for every version real rc.2 advertises', async () => {
    // Pinned rc.2 hardcodes host.describe.version = "0.0.1", verified against a
    // real dsh web; an exact-string gate would withhold writes from real rc.2.
    for (const version of ['0.1.1-rc.2', '0.0.1']) {
      const probe = await DshRc2NodeAdapter.probe(probeCarrier(version), streamProof)
      expect(probe.compatibility).toBe('SUPPORTED')
      expect(probe.capabilities.has('session.write')).toBe(true)
    }
    const experimental = await DshRc2NodeAdapter.probe(probeCarrier('9.9.9-unknown'), streamProof)
    expect(experimental.compatibility).toBe('EXPERIMENTAL')
    expect(experimental.capabilities.has('session.write')).toBe(false)
  })

  it('treats a disabled session-query index as an absent optional capability', async () => {
    const probe = await DshRc2NodeAdapter.probe(probeCarrier('0.0.1', 'session.search'), streamProof)
    expect(probe.compatibility).toBe('SUPPORTED')
    expect(probe.capabilities.has('session.search')).toBe(false)
    expect(probe.capabilities.has('session.write')).toBe(true)
    expect(probe.diagnostic).toMatch(/content search disabled/)

    // A node whose index is closed contributes no hits instead of failing.
    const adapter = new DshRc2NodeAdapter(descriptor, probeCarrier('0.0.1', 'session.search'), probe.capabilities)
    await expect(adapter.search({ query: 'anything', limit: 5 })).resolves.toEqual([])
  })

  it('withholds directory capabilities when the remote picker does not serve browse', async () => {
    const probe = await DshRc2NodeAdapter.probe(probeCarrier('0.0.1', 'host.listDirectory'), streamProof)
    expect(probe.compatibility).toBe('SUPPORTED')
    expect(probe.capabilities.has('directory.read')).toBe(false)
    expect(probe.capabilities.has('directory.write')).toBe(false)
    expect(probe.diagnostic).toMatch(/directory browse not served/)
  })

  it('downgrades search at call time when availability changes after the probe', async () => {
    let allowSearch = true
    const flaky = carrier((method, request) => {
      if (method === 'session.search' && !allowSearch) {
        return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: 'session search is disabled' } } }))
      }
      if (method === 'session.search') return success(request.rpcId as string, { items: [], hasMore: false })
      return success(request.rpcId as string, { items: [] })
    })
    const adapter = new DshRc2NodeAdapter(descriptor, flaky, full)
    await expect(adapter.search({ query: 'x', limit: 5 })).resolves.toEqual([])
    allowSearch = false
    await expect(adapter.search({ query: 'x', limit: 5 })).resolves.toEqual([])
  })

  it('fails incompatible when a core baseline/stream capability or schema is missing', async () => {
    await expect(DshRc2NodeAdapter.probe(probeCarrier('0.1.1-rc.2'), { generation: 1, opened: new Set(['mux', 'host']) } as never)).resolves.toMatchObject({ compatibility: 'INCOMPATIBLE' })
    await expect(DshRc2NodeAdapter.probe(probeCarrier('0.1.1-rc.2', 'session.list'), streamProof)).resolves.toMatchObject({ compatibility: 'INCOMPATIBLE' })
    await expect(DshRc2NodeAdapter.probe(carrier((_method, request) => success(request.rpcId as string, { version: '0.1.1-rc.2' })), streamProof)).rejects.toThrow(/host\.describe\.cwd/)
  })
})

describe('DshRc2NodeAdapter contracts', () => {
  it('converts workspace/session baselines and preserves node ownership under unknown fields', async () => {
    const adapter = new DshRc2NodeAdapter(descriptor, carrier((method, request) => {
      if (method === 'workspace.list') return success(request.rpcId as string, { items: [{ ...workspaceView('w1', 'Backend', '/remote/backend', ['s1', 's2']), unknown: true }], archivedSessionIds: ['s2'], extra: 'ignored' })
      return success(request.rpcId as string, { items: [{ sessionId: 's1', updatedAt: 1000, running: true, blank: false, cwd: '/remote/backend', projections: { asOfSeq: 8, values: { title: 'Session' } }, unknown: true }] })
    }), full)
    const workspaces = await adapter.listWorkspaces()
    const sessions = await adapter.listSessions()
    expect(workspaces[0]).toMatchObject({ title: 'Backend', path: '/remote/backend', order: 0 })
    expect(workspaces[0]!.sessionIds[0]).toMatch(/^fed1:vm-a:s:/)
    expect(workspaces[0]!.archivedSessionIds[0]).toMatch(/^fed1:vm-a:s:/)
    expect(sessions[0]).toMatchObject({ title: 'Session', path: '/remote/backend', status: 'running', seq: 8 })
    expect(sessions[0]!.workspaceId).toMatch(/^fed1:vm-a:w:/)
  })

  it('maps every stable command to its exact rc.2 method and native identity', async () => {
    const methods: string[] = []
    const adapter = new DshRc2NodeAdapter(descriptor, carrier((method, request) => {
      methods.push(method)
      if (method === 'workspace.insertBefore') expect(request.payload).toEqual({ workspaceId: 'w1', beforeWorkspaceId: 'w2' })
      if (method === 'workspace.insertSessionBefore') expect(request.payload).toEqual({ workspaceId: 'w1', sessionId: 's1', beforeSessionId: 's2' })
      if (method === 'respond') {
        expect(request).toEqual({ type: 'client-response', rpcId: 'interaction-rpc', result: { ok: true, value: {} } })
        return new Response(JSON.stringify({ accepted: true }))
      }
      if (method === 'session.prompt') {
        expect(request.rpcId).toBe('prompt-rpc')
        expect(request.payload).toEqual({ sessionId: 's1', mode: 'queue', content: [] })
        return success(request.rpcId as string, { accepted: true })
      }
      if (method === 'session.search') {
        expect(request.payload).toEqual({ query: 'synthetic' })
        return success(request.rpcId as string, { items: [{ sessionId: 's1', snippet: 'synthetic' }], hasMore: false })
      }
      if (method === 'session.updateQueue') {
        expect(request.payload).toEqual({ sessionId: 's1', itemId: 'm1', action: { kind: 'remove' } })
        return success(request.rpcId as string, { accepted: true })
      }
      if (method === 'workspace.list') return success(request.rpcId as string, { items: [workspaceView('w1', 'Renamed', '/remote', ['s1'])], archivedSessionIds: [] })
      if (method === 'session.list') return success(request.rpcId as string, { items: [{ sessionId: 's1', updatedAt: 1, running: false, blank: false, cwd: '/remote' }] })
      if (method === 'session.history') return success(request.rpcId as string, { events: [], hasMore: false })
      if (method === 'session.models') return success(request.rpcId as string, { current: {}, routable: true, groups: [], failures: [] })
      if (method === 'session.selectModel') return success(request.rpcId as string, { selected: { provider: 'fixture', model: 'fixture' } })
      if (method === 'session.attachment') return success(request.rpcId as string, { attachment: {}, data: 'AA==' })
      if (method === 'workspace.delete') return success(request.rpcId as string, { deleted: true })
      if (method === 'workspace.insertBefore') return success(request.rpcId as string, { workspaceIds: ['w1'] })
      if (method === 'workspace.insertSessionBefore') return success(request.rpcId as string, { workspace: workspaceView('w1', 'W', '/remote', ['s2', 's1']) })
      if (method === 'workspace.archiveSession') return success(request.rpcId as string, { archivedSessionIds: ['s1'] })
      if (method === 'host.listDirectory') return success(request.rpcId as string, { path: '/remote', home: '/remote', crumbs: [], entries: [], truncated: false })
      if (method === 'host.createDirectory') return success(request.rpcId as string, { path: '/remote/child' })
      if (method === 'session.create' || method === 'session.fork') return success(request.rpcId as string, { sessionId: 'new' })
      if (method === 'session.rename') return success(request.rpcId as string, { title: 'x', seq: 2 })
      if (method === 'workspace.create') return success(request.rpcId as string, { workspace: workspaceView('w2', 'New', '/remote/new', []), created: true })
      if (method === 'workspace.rename') return success(request.rpcId as string, { workspace: workspaceView('w1', 'Renamed', '/remote', []) })
      return success(request.rpcId as string, { accepted: true })
    }), full)
    await adapter.createWorkspace('/remote/new')
    await adapter.renameWorkspace('w1' as never, 'Renamed')
    await adapter.deleteWorkspace('w1' as never)
    await adapter.reorderWorkspace('w1' as never, 'w2' as never)
    await adapter.reorderSession('w1' as never, 's1' as never, 's2' as never)
    await adapter.createSession('w1' as never)
    await adapter.history('s1' as never)
    await adapter.models('s1' as never)
    await adapter.prompt({ sessionId: 's1' as never, rpcId: 'prompt-rpc' as RpcId, mode: 'queue', content: [] })
    await adapter.cancel('s1' as never)
    await adapter.renameSession('s1' as never, 'x')
    await adapter.forkSession('s1' as never, 8)
    await adapter.selectModel('s1' as never, { provider: 'fixture', model: 'fixture' })
    await adapter.updateQueue('s1' as never, { itemId: 'm1', action: { kind: 'remove' } })
    await adapter.attachment('s1' as never, 'a1')
    await adapter.listWorkspaces()
    await adapter.listSessions()
    const results = await adapter.search({ query: 'synthetic', limit: 10 })
    expect(results[0]!.session.workspaceId).toMatch(/^fed1:vm-a:w:/)
    expect(results[0]!.snippet).toBe('synthetic')
    await adapter.archiveSession('s1' as never)
    await adapter.respond('interaction-rpc' as RpcId, { type: 'client-response', result: { ok: true, value: {} } })
    await adapter.listDirectory('/remote')
    await adapter.createDirectory('/remote', 'child')
    expect(methods).toEqual([
      'workspace.create', 'workspace.rename', 'workspace.delete', 'workspace.insertBefore', 'workspace.insertSessionBefore',
      'session.create', 'session.history', 'session.models', 'session.prompt', 'session.cancel', 'session.rename',
      'session.fork', 'session.selectModel', 'session.updateQueue', 'session.attachment',
      'workspace.list', 'session.list', 'session.search',
      'workspace.archiveSession', 'respond', 'host.listDirectory', 'host.createDirectory',
    ])
  })

  it('rejects a search hit that no verified session.list baseline owns', async () => {
    const adapter = new DshRc2NodeAdapter(descriptor, carrier((method, request) => {
      if (method === 'session.search') return success(request.rpcId as string, { items: [{ sessionId: 'ghost', snippet: 'x' }], hasMore: false })
      return success(request.rpcId as string, { items: [] })
    }), full)
    await adapter.listSessions()
    await expect(adapter.search({ query: 'x', limit: 5 })).rejects.toMatchObject({ kind: 'Protocol' })
  })

  it('keeps remote business errors distinct from protocol/transport and forwards abort', async () => {
    const controller = new AbortController()
    const adapter = new DshRc2NodeAdapter(descriptor, carrier((_method, request, signal) => {
      expect(signal).not.toBe(controller.signal)
      expect(signal?.aborted).toBe(false)
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { code: 'session-not-found' } } }))
    }), full)
    await expect(adapter.history('missing' as never, { signal: controller.signal })).rejects.toBeInstanceOf(RemoteBusinessError)

    const abortController = new AbortController()
    const aborting = new DshRc2NodeAdapter(descriptor, carrier((_method, _request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })), full)
    const pending = aborting.history('s1' as never, { signal: abortController.signal })
    abortController.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toMatchObject({ kind: 'Aborted' })

    const mismatch = new DshRc2NodeAdapter(descriptor, carrier((_method, request) => success(`${request.rpcId}-wrong`, {})), full)
    await expect(mismatch.history('s1' as never)).rejects.toBeInstanceOf(CarrierError)
  })

  it('validates the full official event envelope, physical stream and method before conversion', () => {
    const mux = { type: 'server-request', rpcId: 'r1', method: 'session/projection', payload: {
      type: 'session/projection', sessionId: 's1', key: 'title', value: 'T', seq: 8,
    } }
    expect(validateRc2EventEnvelope('mux', mux)).toEqual(mux)
    expect(() => validateRc2EventEnvelope('host', mux)).toThrow()
    expect(() => validateRc2EventEnvelope('mux', { ...mux, method: 'session/event' })).toThrow(/method/)
    expect(() => validateRc2EventEnvelope('mux', { ...mux, type: 'client-request' })).toThrow()
    expect(() => validateRc2EventEnvelope('mux', { ...mux, payload: { ...mux.payload, seq: -1 } })).toThrow()
    const host = { type: 'server-request', rpcId: 'r2', method: 'host/session-status', payload: {
      type: 'host/session-status', sessionId: 's1', running: true,
    } }
    expect(validateRc2EventEnvelope('host', host)).toEqual(host)
  })

  it('converts mux/host frames into stable Core frames without leaking rc.2 schema', () => {
    const adapter = new DshRc2NodeAdapter(descriptor, carrier((_method, request) => success(request.rpcId as string, {})), full)
    expect(adapter.convertFrame('mux', { type: 'server-request', rpcId: 'r1', payload: { type: 'session/projection', sessionId: 's1', key: 'title', value: 'T', seq: 8 } }))
      .toMatchObject({ kind: 'reconciliation', frame: { domain: 'session', sessionId: 's1', seq: 8 } })
    expect(adapter.convertFrame('mux', { type: 'server-request', rpcId: 'r2', payload: { type: 'session/event', sessionId: 's1', event: { seq: 11 } } }))
      .toMatchObject({ kind: 'reconciliation', frame: { domain: 'session', seq: 11 } })
    expect(adapter.convertFrame('mux', { type: 'server-request', rpcId: 'r3', payload: { type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 't' } }))
      .toMatchObject({ kind: 'interaction', rpcId: 'r3', interaction: 'approval' })
    expect(adapter.convertFrame('host', { type: 'server-request', rpcId: 'r4', payload: { type: 'host/workspace-changed', workspace: workspaceView('w1', 'T', '/p', []) } }))
      .toMatchObject({ kind: 'reconciliation', frame: { domain: 'workspace-upsert', workspaceId: 'w1' } })
    expect(adapter.convertFrame('host', { type: 'server-request', rpcId: 'r5', payload: { type: 'host/session-removed', sessionId: 's1' } }))
      .toMatchObject({ kind: 'reconciliation', frame: { domain: 'status-remove' } })
    expect(adapter.convertFrame('host', { type: 'server-request', rpcId: 'r6', payload: { type: 'host/workspace-order-changed', workspaceIds: [] } }))
      .toEqual({ kind: 'refresh-required', reason: 'host/workspace-order-changed' })
    expect(adapter.convertFrame('host', { type: 'server-request', rpcId: 'r7', payload: { type: 'stream/error', error: {} } })).toMatchObject({ kind: 'control' })
    expect(() => adapter.convertFrame('mux', { type: 'server-request', rpcId: 'r8', payload: { type: 'host/workspace-changed' } })).toThrow(/host frame arrived on mux/)
    expect(() => adapter.convertFrame('host', { type: 'server-request', rpcId: 'r9', payload: { type: 'session/event', sessionId: 's1', event: { seq: 1 } } })).toThrow(/mux frame arrived on host/)
    expect(() => adapter.convertFrame('mux', { type: 'server-request', rpcId: 'r10', payload: { type: 'session/projection', sessionId: 's1', key: 'k', value: 1 } })).toThrow(/seq must be an integer/)
  })

  it('exposes no forbidden Settings, Subscriptions, Credentials, openPath, sync or process API', () => {
    const prototype = Object.getOwnPropertyNames(DshRc2NodeAdapter.prototype)
    for (const forbidden of ['settings', 'subscriptions', 'credentials', 'openPath', 'sync', 'install', 'start', 'stop']) {
      expect(prototype.some(name => name.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false)
    }
    for (const method of RC2_FORBIDDEN_METHODS) expect(RC2_ALLOWED_METHODS.has(method)).toBe(false)
    expect([...RC2_ALLOWED_METHODS].some(method => /^(settings|credentials|llm)\./.test(method) || method === 'host.openPath' || method === 'host.pickDirectory' || method === 'session.export')).toBe(false)
  })

  it('keeps an allowlist rejection distinct from an absent optional capability', async () => {
    // `probeOptional` forwards a dynamic method name, so the dispatcher's
    // allowlist guard is reachable there. Its rejection is a Protocol
    // CarrierError, never a RemoteBusinessError — otherwise the probe would
    // swallow it and silently report the capability as "not served here".
    // Verified via the real public probe: a deployment-level refusal (business
    // error) yields an absent capability, while a protocol fault propagates.
    const businessRefusal = await DshRc2NodeAdapter.probe(probeCarrier('0.0.1', 'session.search'), streamProof)
    expect(businessRefusal.compatibility).toBe('SUPPORTED')
    expect(businessRefusal.capabilities.has('session.search')).toBe(false)

    const protocolFault = carrier((method, request) => {
      if (method === 'session.search') return new Response('not json at all')
      if (method === 'host.describe') return success(request.rpcId as string, { version: '0.0.1', cwd: '/f', home: '/f', attachedSessions: 0, canOpenPath: false })
      if (method === 'workspace.list') return success(request.rpcId as string, { items: [], archivedSessionIds: [] })
      if (method === 'session.list') return success(request.rpcId as string, { items: [] })
      return success(request.rpcId as string, { path: '/f', home: '/f', crumbs: [], entries: [], truncated: false })
    })
    await expect(DshRc2NodeAdapter.probe(protocolFault, streamProof))
      .rejects.toMatchObject({ kind: 'Protocol' })
  })

  it('routes every outbound rc.2 method through the allowlist', async () => {
    // The runtime guard in the shared dispatcher is defense in depth for future
    // code: today every call site passes a hardcoded literal, so no input can
    // reach it. What IS testable — and what actually protects the boundary — is
    // that each command's outbound path is allowlisted, and that the forbidden
    // set is disjoint from it.
    const attempted: string[] = []
    const spy = new HttpUnaryCarrier({
      endpoint: new URL('http://127.0.0.1:49152'), generation: 1, currentGeneration: () => 1,
      fetch: (async url => {
        attempted.push(new URL(url as URL).pathname.slice('/api/'.length))
        return success('probe', { items: [], hasMore: false })
      }) as typeof globalThis.fetch,
    })
    const adapter = new DshRc2NodeAdapter(descriptor, spy, full)
    await adapter.search({ query: 'x', limit: 1 }).catch(() => undefined)
    await adapter.listWorkspaces().catch(() => undefined)
    await adapter.listSessions().catch(() => undefined)

    expect(attempted.length).toBeGreaterThan(0)
    for (const method of attempted) {
      expect(RC2_ALLOWED_METHODS.has(method) || method === 'respond').toBe(true)
    }
    for (const forbidden of RC2_FORBIDDEN_METHODS) {
      expect(RC2_ALLOWED_METHODS.has(forbidden)).toBe(false)
      expect(attempted).not.toContain(forbidden)
    }
  })
})
