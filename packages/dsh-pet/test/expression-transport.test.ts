/**
 * Transport wiring for URL imports.
 *
 * The committed security contract is not "an agent constant exists" but "the
 * downloader hands THAT dedicated agent — never the keep-alive, proxy-routable
 * global one — to `https.request`, together with the pinned lookup". Mocking
 * `node:https` lets the test observe the real call options without a network
 * or a subprocess proxy.
 */

import { Agent, globalAgent } from 'node:https'
import { describe, expect, it, vi } from 'vitest'

/** Options captured from the mocked `https.request` call. */
interface CapturedOptions {
  agent?: unknown
  lookup?: unknown
  headers?: Record<string, string>
}

const captured: CapturedOptions[] = []

vi.mock('node:https', async importOriginal => {
  const actual = await importOriginal<typeof import('node:https')>()
  return {
    ...actual,
    request: vi.fn(
      (
        _url: unknown,
        options: CapturedOptions,
        callback: (response: {
          statusCode: number
          headers: Record<string, string>
          destroy: () => void
        }) => void,
      ) => {
        captured.push(options)
        callback({ statusCode: 200, headers: { 'content-type': 'application/json' }, destroy: () => {} })
        return { on: () => undefined, end: () => undefined }
      },
    ),
  }
})

import {
  defaultRequest,
  EXPRESSION_REQUEST_AGENT,
} from '../src/host/expression-fetch.js'

describe('URL import transport wiring', () => {
  it('passes the dedicated agent and the pinned lookup to https.request', async () => {
    captured.length = 0
    const target = { addresses: [{ address: '93.184.216.34', family: 4 as const }] }

    await defaultRequest(new URL('https://cdn.example/a.json'), target, 1000)

    const options = captured[0]
    expect(options).toBeDefined()
    // The security fix: not the global (keep-alive, possibly proxied) agent.
    expect(options?.agent).toBe(EXPRESSION_REQUEST_AGENT)
    expect(options?.agent).not.toBe(globalAgent)
    expect(options?.agent).toBeInstanceOf(Agent)
    // The pinned lookup must travel with the request, not be re-resolved by net.
    expect(typeof options?.lookup).toBe('function')
    // No cookies/credentials; compression opt-out is explicit.
    expect(options?.headers?.['accept-encoding']).toBe('identity')
  })
})
