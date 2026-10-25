/** Real fetch uses the Host-installed global dispatcher and decodes compression. */
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { getGlobalDispatcher, setGlobalDispatcher, MockAgent } from 'undici'
import { fetchExpressionSource } from '../src/host/expression-fetch.js'
import { MAX_EXPRESSION_SOURCE_BYTES } from '../src/wire.js'

const original = getGlobalDispatcher()
let agent: MockAgent | undefined

afterEach(async () => {
  setGlobalDispatcher(original)
  await agent?.close()
  agent = undefined
})

function installHostDispatcher() {
  agent = new MockAgent()
  agent.disableNetConnect()
  setGlobalDispatcher(agent)
  return agent.get('https://assets.invalid:8443')
}

describe('Host fetch transport', () => {
  it('uses the existing global dispatcher without resolving the target locally', async () => {
    const host = installHostDispatcher()
    host.intercept({ path: '/a.json', method: 'GET' }).reply(200, '{"v":"5.7.0"}')
    await expect(fetchExpressionSource('https://assets.invalid:8443/a.json')).resolves.toBe('{"v":"5.7.0"}')
    expect(getGlobalDispatcher()).toBe(agent)
    agent!.assertNoPendingInterceptors()
  })

  it('decodes gzip with the ordinary fetch transport', async () => {
    const text = '{"v":"5.7.0","layers":[{"ty":4}]}'
    const body = gzipSync(text)
    installHostDispatcher().intercept({ path: '/a.json' }).reply(200, body, {
      headers: { 'content-encoding': 'gzip', 'content-length': String(body.length), 'content-type': 'text/plain' },
    })
    await expect(fetchExpressionSource('https://assets.invalid:8443/a.json')).resolves.toBe(text)
  })

  it('limits decompressed bytes even when the wire body is small', async () => {
    const body = gzipSync('x'.repeat(MAX_EXPRESSION_SOURCE_BYTES + 1))
    expect(body.length).toBeLessThan(MAX_EXPRESSION_SOURCE_BYTES)
    installHostDispatcher().intercept({ path: '/a.json' }).reply(200, body, {
      headers: { 'content-encoding': 'gzip', 'content-length': String(body.length) },
    })
    await expect(fetchExpressionSource('https://assets.invalid:8443/a.json')).rejects.toMatchObject({ code: 'EXPRESSION_FETCH_FAILED' })
  })
})
