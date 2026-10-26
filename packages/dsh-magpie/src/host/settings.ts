import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
export interface Settings { baseUrl: string; visibleModels: Record<string, string[]>; defaultEfforts: Record<string, string>; credentialUpdatePending?: string[] }
export class SettingsStore {
  value: Settings = { baseUrl: '', visibleModels: {}, defaultEfforts: {} }
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
