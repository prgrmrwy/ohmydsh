/** Real Host StopPreparation + descriptor against the real launcher consumer. */
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { StopPreparation, publishStopDescriptor, releaseStopDescriptor, PET_PREPARE_STOP_ROUTE } from '../src/host/locus/stop-preparation.js'
// @ts-expect-error launcher module is plain ESM without declarations
import { preparePetStop, verifyStopProtocol } from '../../../scripts/launcher/pet-stop.mjs'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step() })

async function hostFixture(drain: () => Promise<void> = async () => {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-stop-contract-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const identity = { hostPid: process.pid, bootId: 'contract-boot-identity' }
  const resumed: string[] = []
  const stop = new StopPreparation(identity, { freeze: async () => {}, drain, resume: async () => { resumed.push('resumed') } })
  const server: Server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/?token=contract-only') {
      response.writeHead(303, { location: '/', 'set-cookie': 'dsh_auth=contract-cookie; HttpOnly; Path=/' }).end(); return
    }
    if (request.method !== 'POST' || request.url !== PET_PREPARE_STOP_ROUTE || request.headers.cookie !== 'dsh_auth=contract-cookie') {
      response.writeHead(401).end(); return
    }
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      stop.request(JSON.parse(body)).then(
        data => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, data })),
        error => response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: String(error) })),
      )
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const port = (server.address() as { port: number }).port
  const origin = `http://127.0.0.1:${port}`
  await publishStopDescriptor(home, port, { v: 1, pid: identity.hostPid, bootId: identity.bootId, profile: 'web', origin, authenticatedUrl: `${origin}/?token=contract-only` })
  const initial = { state: 'owned', processes: [{ pid: process.pid, created: 'contract-created', argv: ['node', 'dsh'], executable: process.execPath }] }
  return { home, port, identity, stop, resumed, initial, probe: async () => structuredClone(initial) }
}

it('real prepared ticket survives the launcher pre-signal status check, then resumes', async () => {
  const h = await hostFixture()
  const ticket = await preparePetStop({ home: h.home, port: h.port, initial: h.initial, probe: h.probe, env: {}, warn: () => {} })
  await expect(ticket.beforeSignal()).resolves.toBeUndefined()
  expect(await ticket.resume()).toBe('resumed')
  expect(h.resumed).toEqual(['resumed'])
  await expect(verifyStopProtocol({ home: h.home, port: h.port, initial: h.initial, probe: h.probe, env: {} })).resolves.toBeUndefined()
})

it('a failed drain is recovered by the launcher without leaving the Host frozen', async () => {
  const h = await hostFixture(async () => { throw new Error('durable close failed') })
  await expect(preparePetStop({ home: h.home, port: h.port, initial: h.initial, probe: h.probe, env: {}, warn: () => {} })).rejects.toThrow('Pet 已恢复')
  expect(h.resumed).toEqual(['resumed'])
})

it('a stale descriptor from another boot grants nothing and the release keeps a replacement file', async () => {
  const h = await hostFixture()
  await releaseStopDescriptor(h.home, h.port, 'some-other-boot')
  const foreign = { ...h.initial, processes: [{ ...h.initial.processes[0]!, pid: process.pid + 100_000 }] }
  // A stale or absent descriptor grants nothing: the launcher stops WITHOUT
  // Pet drain (warning only) and never prepares through it (2026-11-06).
  const warnings: string[] = []
  const stale = await preparePetStop({ home: h.home, port: h.port, initial: foreign, probe: async () => structuredClone(foreign), env: {}, warn: (line: string) => { warnings.push(line) } })
  expect(await stale.resume()).toBe('not-needed')
  await releaseStopDescriptor(h.home, h.port, h.identity.bootId)
  const absent = await preparePetStop({ home: h.home, port: h.port, initial: h.initial, probe: h.probe, env: {}, warn: (line: string) => { warnings.push(line) } })
  expect(await absent.resume()).toBe('not-needed')
  expect(warnings).toHaveLength(2)
  expect(warnings.every(line => /无 Pet 停止凭据/.test(line))).toBe(true)
})
