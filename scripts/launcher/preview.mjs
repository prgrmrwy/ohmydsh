import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from '../lib/child-process.mjs'
import { probePort, stopServer } from './process.mjs'

export function isolatedHome(repo, home) {
  // Ordinary homes need no Git subprocess (history remains side-effect free).
  let cursor = path.resolve(home), suffix = []
  while (!fs.existsSync(cursor)) { suffix.unshift(path.basename(cursor)); const parent = path.dirname(cursor); if (parent === cursor) throw new Error('Cannot resolve DSH_HOME'); cursor = parent }
  const resolved = path.join(fs.realpathSync(cursor), ...suffix)
  if (!resolved.includes(`${path.sep}ws${path.sep}dsh-home${path.sep}`)) return false
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: repo, encoding: 'utf8' })
  if (result.status !== 0) return false
  const common = result.stdout.trim()
  const root = path.join(fs.realpathSync(path.resolve(repo, common)), 'ws/dsh-home')
  return resolved.startsWith(`${root}${path.sep}`)
}
export function readPreview(home) {
  try {
    const file = path.join(home, 'preview.json')
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Preview record must not be a symbolic link')
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || value.port === 3080 || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.created !== 'string' || !value.created) throw new Error('Invalid preview identity record')
    return value
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw new Error('Unreadable preview.json; refusing to infer ownership') }
}
export const matchesPreview = (result, record) => result.state === 'owned' && result.processes?.length === 1 && result.processes[0].pid === record?.pid && result.processes[0].created === record?.created
export function writePreview(home, record) {
  const file = path.join(home, 'preview.json'), temp = `${file}.${randomUUID()}.tmp`
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  try { fs.writeFileSync(temp, JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file) }
  finally { fs.rmSync(temp, { force: true }) }
}
export async function stopPreview(home, { env = process.env, probe = probePort, stop = stopServer, warn = console.error } = {}) {
  const record = readPreview(home)
  if (!record) return { ok: true, state: 'empty' }
  const current = await probe(record.port, { env })
  if (current.state === 'probe-error') throw new Error(current.error || 'Preview ownership probe failed')
  if (matchesPreview(current, record)) {
    const result = await stop(record.port, { env, warn, probe: async () => {
      const next = await probe(record.port, { env })
      return next.state === 'empty' || matchesPreview(next, record) ? next : { ...next, state: 'unknown', error: 'Preview identity changed' }
    } })
    if (!result.ok) throw new Error(result.error || 'Failed to stop own preview')
  }
  fs.rmSync(path.join(home, 'preview.json'), { force: true })
  return { ok: true, state: 'empty' }
}
export function previewPorts(start, explicit = false) {
  if (explicit) return [start]
  if (!Number.isInteger(start) || start < 3180 || start > 3279) throw new Error('Preview port must be in 3180..3279; run ws prepare-preview')
  return Array.from({ length: 20 }, (_, offset) => 3180 + (start - 3180 + offset) % 100)
}
