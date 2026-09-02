/**
 * Management-API client error handling.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { petApi, PetApiError } from '../src/client/api.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stub one fetch response. */
function respond(status: number, body: string): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ status, text: async () => body })))
}

describe('a non-JSON response is reported as what it is', () => {
  it('explains an unregistered route rather than failing to parse', async () => {
    // A Pet route that never registered answers 405 with an empty body.
    // Calling `response.json()` on that produced
    // "Unexpected end of JSON input", which hid the real problem.
    respond(405, '')

    await expect(petApi.config()).rejects.toMatchObject({
      code: 'PET_UNAVAILABLE',
    })
    await expect(petApi.config()).rejects.toThrow(/重启 DSH/)
  })

  it('surfaces the status when the body is empty for another reason', async () => {
    respond(500, '')
    await expect(petApi.config()).rejects.toThrow(/HTTP 500/)
  })

  it('quotes a non-JSON body instead of throwing a parse error', async () => {
    respond(502, '<html>Bad Gateway</html>')

    const error = await petApi.config().catch((cause: unknown) => cause as PetApiError)
    expect(error.message).toContain('Bad Gateway')
    expect(error.message).not.toContain('JSON')
  })

  it('still reports a normal Pet error envelope', async () => {
    respond(400, JSON.stringify({ ok: false, error: 'INVALID_REQUEST', message: 'bad field' }))

    await expect(petApi.config()).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'bad field',
    })
  })

  it('returns data on success', async () => {
    respond(200, JSON.stringify({ ok: true, data: { providerId: 'claude' } }))

    await expect(petApi.config()).resolves.toMatchObject({ providerId: 'claude' })
  })
})
