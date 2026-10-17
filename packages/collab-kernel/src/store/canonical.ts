import { createHash } from 'node:crypto'

function sorted(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Expected acyclic JSON values')
  const array = Array.isArray(value)
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Expected plain JSON object')
  ancestors.add(value)
  try {
    if (array) return Array.from(value, entry => sorted(entry, ancestors))
    // A null prototype preserves an own "__proto__" key as data.
    const out: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry !== undefined) out[key] = sorted(entry, ancestors)
    }
    return out
  } finally { ancestors.delete(value) }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value))
}

export function checksum(value: Record<string, unknown>): string {
  const { sha256: _ignored, ...body } = value
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')
}

export function encodeRecord(value: Record<string, unknown>): string {
  const body = sorted(value) as Record<string, unknown>
  return `${JSON.stringify({ ...body, sha256: checksum(body) })}\n`
}

export function decodeRecord(line: string): Record<string, unknown> {
  const value = JSON.parse(line)
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.sha256 !== 'string' || checksum(value) !== value.sha256) throw new Error('corrupt')
  const { sha256: _digest, ...body } = value
  return body
}
