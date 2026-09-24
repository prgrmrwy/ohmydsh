import { request as httpRequest } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import * as ConnectionPlugin from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COLLABORATION_CONTEXT_LIMITS, COLLABORATION_CONTEXT_SHARING_SCOPE,
  CollaborationContextError, createEmptyCollaborationContext, updateCollaborationContext,
  type CollaborationContextRecord,
} from '../src/host/collaboration/context.js'
import { CollaborationContextStoreError } from '../src/host/collaboration/context-store.js'
import {
  createCollaborationContextRoutes, type CollaborationContextRouteDeps,
} from '../src/host/collaboration/routes.js'

const path = '/api/pet/collaboration/context'
const parent = 'session-parent'
const replacement = () => ({
  parentSessionId: parent, expectedRevision: 0,
  workDescription: 'Shared work', resourceReferences: ['docs/design.md'],
  commonConstraints: ['No automatic sharing'], sources: ['Operator correction'],
  sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE,
})

/**
 * Real installed Connection + WebServer exact registration and HTTP requests.
 * Only credentials backing and context persistence are in-memory test ports;
 * authentication is never replaced by a blanket allow verdict. Durable CAS and
 * crash atomicity remain the separate context-store suite's responsibility.
 */
describe('owner collaboration context routes', () => {
  let ctx: Context
  let dispose: () => Promise<void>
  let base: string
  let cookie: string
  let rows: Map<string, CollaborationContextRecord>
  let history: Map<string, CollaborationContextRecord[]>
  let store: CollaborationContextRouteDeps['store']
  let ownerIdentity: ReturnType<typeof vi.fn>
  let now: ReturnType<typeof vi.fn>
  let register: (overrides?: Partial<CollaborationContextRouteDeps>) => void

  beforeEach(async () => {
    ctx = new Context()
    const credentials = new Map<unknown, unknown>()
    ctx.provide('credentials', {
      async modifyRecord(key: unknown, mutate: (current: unknown) => Promise<unknown>) {
        const next = await mutate(credentials.get(key))
        if (next !== undefined) credentials.set(key, next)
        return credentials.get(key)
      },
    })
    const web = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await web
    const connection = ctx.plugin(ConnectionPlugin)
    await connection
    dispose = async () => { await connection.dispose(); await web.dispose() }
    ctx.webServer.registerFallback((req, res) => {
      if (!ctx.connection.authorizeIndex(req, res)) return
      res.writeHead(404)
      res.end('not found')
    })
    base = `http://127.0.0.1:${ctx.webServer.port}`
    const login = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' })
    expect(login.status).toBe(303)
    cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!
    expect(cookie).toMatch(/^dsh-auth-/)
    const empty = createEmptyCollaborationContext({ parentSessionId: parent })
    rows = new Map([[parent, empty]])
    history = new Map([[parent, [empty]]])
    store = {
      get: vi.fn((id: string) => rows.get(id)),
      audit: vi.fn((id: string) => history.get(id) ?? []),
      update: vi.fn(async (id: string, input: unknown, writer: unknown) => {
        const current = rows.get(id)
        if (!current) throw new CollaborationContextStoreError('CONTEXT_NOT_FOUND')
        const next = updateCollaborationContext(current, input, writer)
        rows.set(id, next)
        history.set(id, [...history.get(id)!, next])
        return next
      }),
    }
    ownerIdentity = vi.fn(() => ({ kind: 'local-owner', actorId: 'owner:verified-browser' }))
    now = vi.fn(() => 1_800_000_000_123)
    register = (overrides = {}) => {
      const routes = createCollaborationContextRoutes({
        store, browserAuth: ctx.connection, ownerIdentity, now, ...overrides,
      })
      expect(routes.map(route => route.path)).toEqual([path])
      for (const route of routes) ctx.webServer.register({ kind: 'exact', ...route })
    }
  })
  afterEach(async () => { await dispose?.() })

  const read = (base: string, cookie: string, query = `?parentSessionId=${parent}`) =>
    fetch(`${base}${path}${query}`, { headers: { cookie, origin: base } })
  const post = (base: string, cookie: string, body: unknown, suffix = '') =>
    fetch(`${base}${path}${suffix}`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it.each(['GET', 'POST'])('denies unauthenticated %s before owner/store access', async method => {
    register()
    for (const badCookie of ['', 'dsh-auth-forged=local-owner']) {
      const response = await fetch(`${base}${path}?parentSessionId=${parent}`, {
        method, headers: { origin: base, cookie: badCookie },
        ...(method === 'POST' ? { body: JSON.stringify(replacement()) } : {}),
      })
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('unauthorized')
    }
    expect(ownerIdentity).not.toHaveBeenCalled()
    expect(store.get).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })

  it('retains the actual Connection Host and origin fences with a valid cookie', async () => {
    register()
    for (const headers of [{ host: 'evil.example' }, { origin: 'https://evil.example' }]) {
      // Node fetch rewrites Host, so use raw HTTP to test a hostile authority.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(`${base}${path}?parentSessionId=${parent}`, {
          headers: { cookie, origin: base, ...headers },
        }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)) })
        request.on('error', reject)
        request.end()
      })
      expect(status).toBe(403)
    }
    expect(ownerIdentity).not.toHaveBeenCalled()
  })

  it.each([undefined, {}])('denies a missing/unavailable browser auth API: %j', async browserAuth => {
    register({ browserAuth: browserAuth as CollaborationContextRouteDeps['browserAuth'] })
    expect((await read(base, cookie)).status).toBe(401)
    expect((await post(base, cookie, replacement())).status).toBe(401)
    expect(ownerIdentity).not.toHaveBeenCalled()
  })

  it('fails closed when the auth service throws without leaking its error', async () => {
    register({ browserAuth: { requestRejection: () => { throw new Error('SECRET auth storage path') } } })
    const response = await read(base, cookie)
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain('SECRET')
    expect(store.get).not.toHaveBeenCalled()
  })

  it.each([
    undefined, { actorId: 'host:dsh-pet' }, { kind: 'group-allowlist', actorId: 'group-member' },
    { kind: 'agent', actorId: 'local-owner' }, { kind: 'local-owner', actorId: '' },
  ])('rejects missing/non-owner Host identity %j for both reads and writes', async identity => {
    ownerIdentity.mockReturnValue(identity)
    register()
    expect((await read(base, cookie)).status).toBe(403)
    expect((await post(base, cookie, replacement())).status).toBe(403)
    expect(store.get).not.toHaveBeenCalled()
    expect(store.audit).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })

  it('denies when the Host owner callback itself is absent', async () => {
    register({ ownerIdentity: undefined })
    expect((await read(base, cookie)).status).toBe(403)
    expect((await post(base, cookie, replacement())).status).toBe(403)
    expect(store.get).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })

  it('reads current plus owner audit using the authenticated owner-selected parent only', async () => {
    register()
    const response = await read(base, cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true, data: { current: rows.get(parent), audit: history.get(parent) } })
    expect(ownerIdentity).toHaveBeenCalledWith(parent)
    expect(store.get).toHaveBeenCalledWith(parent)
    expect(store.audit).toHaveBeenCalledWith(parent)
    expect(now).not.toHaveBeenCalled()
  })

  it('honors target-specific Host owner authorization instead of trusting parent selection alone', async () => {
    ownerIdentity.mockImplementation(id => id === parent
      ? { kind: 'local-owner', actorId: 'owner:verified-browser' } : undefined)
    register()
    expect((await read(base, cookie, '?parentSessionId=other')).status).toBe(403)
    expect((await post(base, cookie, { ...replacement(), parentSessionId: 'other' })).status).toBe(403)
    expect(store.get).not.toHaveBeenCalled()
    expect(store.audit).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })

  it('retains persisted revision-history access after parent invalidation without inspecting/loading/ensuring sessions', async () => {
    // These are the only capabilities provided: no caller resolver, live parent,
    // ensure, lifecycle provisioning or session creation is available to route.
    register()
    expect((await post(base, cookie, replacement())).status).toBe(200)
    const response = await read(base, cookie)
    expect(response.status).toBe(200)
    expect((await response.json()).data.audit).toHaveLength(2)
  })

  it('uses only Host owner and clock for attribution, and supports withdrawal as full replacement', async () => {
    register()
    const response = await post(base, cookie, replacement())
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      revision: 1, status: 'authored', authoredBy: 'owner:verified-browser',
      authoredAt: 1_800_000_000_123, authoredByLocus: { kind: 'parent' },
      sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE,
    })
    expect(store.update).toHaveBeenCalledWith(parent, {
      expectedRevision: 0, workDescription: 'Shared work', resourceReferences: ['docs/design.md'],
      commonConstraints: ['No automatic sharing'], sources: ['Operator correction'],
    }, {
      parentSessionId: parent, authoredBy: 'owner:verified-browser', authoredAt: 1_800_000_000_123,
      authorLocus: { kind: 'parent' }, sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE,
    })
    const cleared = await post(base, cookie, {
      ...replacement(), expectedRevision: 1, workDescription: '', resourceReferences: [], commonConstraints: null,
    })
    expect(cleared.status).toBe(200)
    const result = await (await read(base, cookie)).json()
    expect(result.data.current).toMatchObject({ revision: 2, workDescription: '', resourceReferences: [], commonConstraints: null })
    expect(result.data.audit).toHaveLength(3)
    expect(result.data.audit[1].workDescription).toBe('Shared work')
  })

  it('maps stale revisions to 409, retaining current and audit', async () => {
    register()
    expect((await post(base, cookie, replacement())).status).toBe(200)
    const conflict = await post(base, cookie, { ...replacement(), workDescription: 'Must not win' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ ok: false, error: 'REVISION_CONFLICT' })
    expect(rows.get(parent)?.workDescription).toBe('Shared work')
    expect(history.get(parent)).toHaveLength(2)
  })

  it.each(['operator', 'actorId', 'authoredBy', 'authoredAt', 'authorLocus', 'explicitConfirmation', 'owner', 'groupAllowlist', 'executionRoot', 'revision'])('rejects body authority/unknown field %s', async field => {
    register()
    const response = await post(base, cookie, { ...replacement(), [field]: 'SECRET-injected' })
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('SECRET')
    expect(store.update).not.toHaveBeenCalled()
  })

  it.each([
    { sharingScope: 'workspace' }, { sharingScope: undefined },
    { expectedRevision: -1 }, { expectedRevision: '0' }, { resourceReferences: 'file' },
    { sources: [] }, { commonConstraints: [''] },
    { workDescription: 'x'.repeat(COLLABORATION_CONTEXT_LIMITS.workDescriptionLength + 1) },
  ])('rejects invalid replacement case %# before persistence', async patch => {
    register()
    expect((await post(base, cookie, { ...replacement(), ...patch })).status).toBe(400)
    expect(store.update).not.toHaveBeenCalled()
  })

  it.each(Object.keys(replacement()))('requires full replacement field %s', async field => {
    register()
    const input: Record<string, unknown> = replacement()
    delete input[field]
    expect((await post(base, cookie, input)).status).toBe(400)
    expect(store.update).not.toHaveBeenCalled()
  })

  it.each(['', '?parentSessionId=', '?parentSessionId=%20parent%20', '?parentSessionId=a&parentSessionId=b', `?parentSessionId=${parent}&revision=0`])('rejects malformed/extra GET selectors %s', async query => {
    register()
    expect((await read(base, cookie, query)).status).toBe(400)
    expect(store.get).not.toHaveBeenCalled()
    expect(store.audit).not.toHaveBeenCalled()
  })

  it('does not expose alternate paths, methods, query-selected POST, or create missing parents', async () => {
    register()
    expect((await fetch(`${base}${path}/audit`, { headers: { cookie } })).status).toBe(404)
    expect((await fetch(`${base}${path}`, { method: 'PUT', headers: { cookie }, body: '{}' })).status).toBe(400)
    expect((await post(base, cookie, replacement(), '?parentSessionId=other')).status).toBe(400)
    expect((await read(base, cookie, '?parentSessionId=session-absent')).status).toBe(404)
    expect((await post(base, cookie, { ...replacement(), parentSessionId: 'session-absent' })).status).toBe(404)
    expect([...rows.keys()]).toEqual([parent])
  })

  it.each([
    [new CollaborationContextError('REVISION_OVERFLOW'), 409],
    [new CollaborationContextError('PARENT_MISMATCH'), 403],
    [new CollaborationContextStoreError('TRANSACTION_UNAVAILABLE'), 503],
    [new CollaborationContextStoreError('CONTEXT_CORRUPT'), 503],
    [new Error('SECRET private database path'), 500],
  ])('safely maps persistence failure %j to %s', async (error, status) => {
    vi.mocked(store.update).mockRejectedValue(error)
    register()
    const response = await post(base, cookie, replacement())
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('SECRET')
    expect(rows.get(parent)?.revision).toBe(0)
    expect(history.get(parent)).toHaveLength(1)
  })

  it('collapses unexpected current/audit errors without exposing storage diagnostics', async () => {
    register()
    vi.mocked(store.get).mockImplementationOnce(() => { throw new Error('SECRET storage path') })
    const currentFailure = await read(base, cookie)
    expect(currentFailure.status).toBe(500)
    expect(await currentFailure.text()).not.toContain('SECRET')
    vi.mocked(store.audit).mockImplementationOnce(() => { throw new Error('SECRET audit path') })
    const auditFailure = await read(base, cookie)
    expect(auditFailure.status).toBe(500)
    expect(await auditFailure.text()).not.toContain('SECRET')
  })

  it('does not forward unexpected identity errors or invalid Host timestamps', async () => {
    ownerIdentity.mockImplementationOnce(() => { throw new Error('SECRET identity') })
    register()
    const response = await read(base, cookie)
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('SECRET')
    now.mockReturnValue(NaN)
    expect((await post(base, cookie, replacement())).status).toBe(503)
    expect(store.update).not.toHaveBeenCalled()
  })
})
