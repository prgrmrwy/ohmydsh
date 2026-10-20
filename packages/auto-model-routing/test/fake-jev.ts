import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type Reply = (req: IncomingMessage, res: ServerResponse, body: string) => void
/** Loopback Jev stand-in (test-only). `reply` may be swapped per case. */
export async function fakeJev(initial: Reply) {
 let reply = initial
 const bodies: unknown[] = []
 const headers: Record<string, string | string[] | undefined>[] = []
 const server = createServer((req, res) => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => { headers.push(req.headers); try { bodies.push(JSON.parse(body)) } catch { bodies.push(body) } reply(req, res, body) })
 })
 await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
 const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
 return {
  base, bodies, headers,
  set(next: Reply) { reply = next },
  close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()) }),
 }
}
export const json = (status: number, value: unknown): Reply => (_req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
export const tier = (choice: string) => json(200, { model: 'typesafe/jev-1.13-20260917', answers: { tier: { type: 'choice', choice, probabilities: {}, confidence: 1 } }, usage: { input_tokens: 1, output_tokens: 1 } })
