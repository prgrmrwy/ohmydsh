import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

export type AccessMode = 'direct' | 'cloudflare'
export type CredentialField = 'key' | 'accessClientId' | 'accessClientSecret'
/** One configured Magpie ingress line: address + its own credentials binding. */
export interface LineSettings { id: string; baseUrl: string; accessMode: AccessMode }
/** A credential write that may have been attempted by a settings write. */
export interface PendingCredential { lineId: string; field: CredentialField }

/**
 * Single settings schema (BREAKING, no legacy fields): an ordered line list,
 * display preferences and the restart-safe credential-write quarantine.
 */
export interface Settings {
  lines: LineSettings[]
  visibleModels: Record<string, string[]>
  defaultEfforts: Record<string, string>
  credentialUpdatePending?: PendingCredential[]
  /** Owner keys seen so far (first-seen order, max {@link MAX_OWNERS}); each owns one registered LLM route. */
  knownOwners?: string[]
}
export class SettingsStore {
  value: Settings = { lines: [], visibleModels: {}, defaultEfforts: {} }
  constructor(readonly path?: string) {
    if (path && existsSync(path)) this.value = { ...this.value, ...JSON.parse(readFileSync(path, 'utf8')) }
  }
  save(value: Settings) {
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
      const tmp = `${this.path}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, this.path)
    }
    this.value = value
  }
}
export function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid baseUrl')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/\/v\d+$/.test(url.pathname.replace(/\/+$/, ''))) throw new Error('Invalid baseUrl')
  return url.href.replace(/\/+$/, '')
}

export const MAX_LINES = 5
export const MAX_OWNERS = 32
const OWNER_KEY = /^[a-z0-9][a-z0-9._-]*$/
export const LINE_ID_PATTERN = /^[0-9a-f]{8}$/
export const isAccessMode = (value: unknown): value is AccessMode => value === 'direct' || value === 'cloudflare'
export const isCredentialField = (value: unknown): value is CredentialField => value === 'key' || value === 'accessClientId' || value === 'accessClientSecret'

/** Normalize one persisted line entry; malformed entries are rejected, not guessed. */
export function normalizeLineSettings(value: unknown): LineSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid line')
  const line = value as Record<string, unknown>
  if (typeof line.id !== 'string' || !LINE_ID_PATTERN.test(line.id)) throw new Error('Invalid line id')
  const baseUrl = line.baseUrl === '' ? '' : normalizeBaseUrl(line.baseUrl)
  const accessMode = line.accessMode ?? 'direct'
  if (!isAccessMode(accessMode)) throw new Error('Invalid accessMode')
  return { id: line.id, baseUrl, accessMode }
}

/**
 * Strict load-time validation for the persisted connection. Any violation makes
 * the whole connection read as empty (the caller never sends a request with a
 * partially trusted list); the stored file is left untouched.
 */
export function validateLoadedLines(value: unknown): LineSettings[] {
  if (!Array.isArray(value)) throw new Error('Invalid lines')
  if (value.length > MAX_LINES) throw new Error('Too many lines')
  const lines = value.map(normalizeLineSettings)
  const ids = new Set<string>()
  const addresses = new Set<string>()
  for (const line of lines) {
    const folded = line.id.toLowerCase()
    if (ids.has(folded)) throw new Error('Duplicate line id')
    ids.add(folded)
    if (line.baseUrl) {
      if (addresses.has(line.baseUrl)) throw new Error('Duplicate line address')
      addresses.add(line.baseUrl)
    }
  }
  return lines
}
export function validatePendingCredentials(value: unknown): PendingCredential[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Invalid pending credentials')
  const pending: PendingCredential[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid pending credentials')
    const record = entry as Record<string, unknown>
    if (typeof record.lineId !== 'string' || !isCredentialField(record.field)) throw new Error('Invalid pending credentials')
    pending.push({ lineId: record.lineId, field: record.field })
  }
  return pending
}

/** Host-generated opaque stable line id: 8 lowercase hex, unique within the supplied set. */
export function randomLineId(existing: Iterable<string>): string {
  const taken = new Set([...existing].map(id => id.toLowerCase()))
  for (;;) {
    const id = randomBytes(4).toString('hex')
    if (!taken.has(id)) return id
  }
}

/**
 * Load-time check of `knownOwners`: missing = empty; anything else invalid (not an array, bad key,
 * duplicate, more than {@link MAX_OWNERS}) throws so the caller resets the WHOLE array (no partial repair).
 */
export function validateKnownOwners(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_OWNERS) throw new Error('Invalid knownOwners')
  for (const key of value) if (typeof key !== 'string' || key.length < 1 || key.length > 48 || !OWNER_KEY.test(key)) throw new Error('Invalid knownOwners')
  if (new Set(value).size !== value.length) throw new Error('Invalid knownOwners')
  return [...value] as string[]
}
