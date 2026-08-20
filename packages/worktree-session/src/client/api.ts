import type { WireEnvelope } from '../wire.ts'
import { ROUTES } from '../wire.ts'

export async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as WireEnvelope<T>
  if (!payload.ok) throw Object.assign(new Error(payload.error.message), { wireError: payload.error })
  return payload.data
}

export { ROUTES }
