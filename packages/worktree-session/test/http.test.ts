import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoutes } from '../src/host/http.js'
import { ROUTES } from '../src/wire.js'

class Request extends EventEmitter {
  method = 'POST'
  headers: Record<string, string> = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' }
  destroy(): void { /* no-op */ }
}
class Response {
  status = 0
  headers: Record<string, string | number> = {}
  body = ''
  writeHead(status: number, headers?: Record<string, string | number>): void { this.status = status; this.headers = headers ?? {} }
  end(body = ''): void { this.body = String(body) }
}

async function call(path: string, body: unknown, mutate?: (request: Request) => void): Promise<Response> {
  const route = createRoutes().find(item => item.path === path)
  if (route === undefined) throw new Error('route missing')
  const request = new Request(); mutate?.(request)
  const response = new Response()
  const promise = route.handler(request as never, response as never)
  queueMicrotask(() => { request.emit('data', Buffer.from(JSON.stringify(body))); request.emit('end') })
  await promise
  return response
}

describe('Host routes', () => {
  it('rejects unknown keys and applies no-store', async () => {
    const response = await call(ROUTES.repoStatus, { repoPath: '/tmp', extra: true })
    expect(response.status).toBe(400)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(response.body).error.code).toBe('INVALID_REQUEST')
  })

  it('rejects untrusted origins before body work', async () => {
    const response = await call(ROUTES.repoStatus, { repoPath: '/tmp' }, request => { request.headers.origin = 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(JSON.parse(response.body).error.code).toBe('UNTRUSTED_REQUEST')
  })

  it('rejects wrong methods', async () => {
    const response = await call(ROUTES.repoStatus, { repoPath: '/tmp' }, request => { request.method = 'GET' })
    expect(response.status).toBe(405)
  })

  it('rejects non-Git paths with a structured envelope', async () => {
    const response = await call(ROUTES.repoStatus, { repoPath: '/tmp' })
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body).error.code).toBe('NOT_A_REPOSITORY')
  })

  it('does not accept caller-asserted active paths on destructive clean', async () => {
    const response = await call(ROUTES.clean, { path: '/tmp/worktree', dryRun: true, activePaths: [] })
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body).error.message).toMatch(/Unknown body key activePaths/)
  })

  it('rejects malformed JSON and oversized declarations', async () => {
    const route = createRoutes().find(item => item.path === ROUTES.repoStatus)!
    const malformed = new Request(); const malformedResponse = new Response()
    const malformedPromise = route.handler(malformed as never, malformedResponse as never)
    queueMicrotask(() => { malformed.emit('data', Buffer.from('{')); malformed.emit('end') })
    await malformedPromise
    expect(malformedResponse.status).toBe(400)
    const oversized = new Request(); oversized.headers['content-length'] = String(70 * 1024)
    const oversizedResponse = new Response()
    const oversizedPromise = route.handler(oversized as never, oversizedResponse as never)
    queueMicrotask(() => oversized.emit('end'))
    await oversizedPromise
    expect(oversizedResponse.status).toBe(413)
  })

  it('maps an unsupported project to 400 with the explicit diagnostic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ws-http-'))
    const exec = promisify(execFile)
    await exec('git', ['init', '-b', 'main'], { cwd: root })
    await exec('git', ['config', 'user.email', 'ws@example.invalid'], { cwd: root })
    await exec('git', ['config', 'user.name', 'WS Test'], { cwd: root })
    await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n')
    await exec('git', ['add', 'package.json'], { cwd: root })
    await exec('git', ['commit', '-m', 'initial'], { cwd: root })
    const response = await call(ROUTES.start, {
      operationId: 'operation-http-unsupported',
      repoPath: root,
      baseRef: 'main',
      taskText: 'unsupported via http',
      dependencyMode: 'lean',
    })
    await rm(root, { recursive: true, force: true })
    expect(response.status).toBe(400)
    const wire = JSON.parse(response.body).error
    expect(wire.code).toBe('UNSUPPORTED_PROJECT')
    expect(wire.message).toMatch(/package-lock\.json|pnpm-lock\.yaml/)
  })
})
