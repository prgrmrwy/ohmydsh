import { CollabError, CollabService, FileStore, principals, type ChannelProvider, type CommandContext } from 'collab-kernel'
import type { Caller } from './session-provider.js'
import { readdir } from 'node:fs/promises'
import { validateConfig, type HostConfig } from './config.js'
import { judgeLock, type Probe } from './maintenance.js'
import { scanLog } from './salvage.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
export interface HostLogger { info(...args: unknown[]): void; warn(...args: unknown[]): void }
export interface HostOptions { logger?: HostLogger; probe?: Probe }
const SPACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export class CollabHost {
  readonly service: CollabService
  readonly tracked = new Set<string>()
  private closing = false
  private pendingClose?: Promise<void>
  private failures = new Map<string, unknown>()
  private constructor(readonly config: Awaited<ReturnType<typeof validateConfig>>, readonly store: FileStore, readonly providers: ChannelProvider[]) {
    const open = store.open.bind(store)
    store.open = (...args) => { this.admissionCheck?.(); return open(...args) }
    const commit = store.commit.bind(store)
    // Commands may await provider sampling after admission. Revalidate the
    // current storage location again at the physical commit admission boundary.
    store.commit = (...args) => { this.admissionCheck?.(); return commit(...args) }
    this.service = new CollabService({ serviceId: config.serviceId, store, providers })
  }
  static async create(config: HostConfig, workspaces: readonly string[], providers: ChannelProvider[], onCreated?: (host: CollabHost) => void, options: HostOptions = {}) {
    const valid = await validateConfig(config, workspaces)
    const host = new CollabHost(valid, new FileStore(valid.dataDir), providers)
    const log = options.logger
    try {
      onCreated?.(host)
      // Startup only: every *.lock, including orphans without a log, is judged
      // before any space opens. Runtime never unlocks or reopens.
      for (const name of (await readdir(valid.dataDir)).filter(name => name.endsWith('.lock')).sort()) {
        if (host.closing) break
        const id = name.slice(0, -5)
        if (!SPACE_ID.test(id) || id === '.' || id === '..') continue
        host.admissionCheck?.()
        let verdict
        try { verdict = await judgeLock(valid.dataDir, id, options.probe) }
        catch (error) { log?.warn(`lock kept: space=${id} instanceId=- pid=- reason=unreadable`); continue }
        if (verdict.remove) {
          try {
            await host.store.breakLock(id, verdict.instanceId)
            log?.info(`lock cleared: space=${id} instanceId=${verdict.instanceId} pid=${verdict.pid}`)
          } catch { log?.warn(`lock kept: space=${id} instanceId=${verdict.instanceId} pid=${verdict.pid} reason=break-refused`) }
        } else log?.warn(`lock kept: space=${id} instanceId=${verdict.instanceId ?? '-'} pid=${verdict.pid ?? '-'} reason=${verdict.reason}`)
      }
      for (const id of await host.store.list()) {
        if (host.closing) break
        host.admissionCheck?.()
        host.tracked.add(id)
        try { await host.service.open(id) } catch (error) {
          host.failures.set(id, error)
          const code = error instanceof CollabError ? error.code : 'COLLAB_HOST_ERROR'
          let line = ''
          if (code === 'COLLAB_STORE_CORRUPT') try { line = ` line=${scanLog(await readFile(join(valid.dataDir, `${id}.jsonl`))).firstBadLine ?? '-'}` } catch {}
          const lock = error instanceof CollabError ? error.details.lock : undefined
          log?.warn(`space unavailable: space=${id} code=${code}${line}${lock ? ` instanceId=${lock.instanceId} pid=${lock.pid}` : ''}`)
        }
      }
      return host
    } catch (error) { await host.close(); throw error }
  }
  /**
   * Agent principal for the resolved caller, with its call-level guard for the
   * kernel. A bare session ID is a Host-vouched `dsh-session` address without
   * a guard (auto-join and maintenance paths).
   */
  context(caller: Caller | string, spaceId: string, cmdId?: string): CommandContext {
    if (typeof caller === 'string') return { principal: principals.agent({ channel: 'dsh-session', address: caller }), spaceId, cmdId: cmdId! }
    return { principal: principals.agent({ channel: caller.channel, address: caller.address }), spaceId, cmdId: cmdId!, guard: caller.guard }
  }
  admissionCheck?: () => void
  private gate(spaceId: string) {
    this.admissionCheck?.()
    if (this.closing) throw new CollabError('COLLAB_SERVICE_CLOSING')
    if (this.failures.has(spaceId)) throw this.failures.get(spaceId)
  }
  async command<T>(_caller: unknown, spaceId: string, _cmdId: string, run: (service: CollabService) => Promise<T>): Promise<T> {
    this.gate(spaceId)
    this.tracked.add(spaceId)
    return run(this.service)
  }
  async read<T>(_caller: unknown, spaceId: string, run: (service: CollabService) => Promise<T>): Promise<T> {
    this.gate(spaceId)
    return run(this.service)
  }
  /** Spaces this Host opened successfully; status never opens or reopens one. */
  openSpaces(): string[] {
    if (this.closing) throw new CollabError('COLLAB_SERVICE_CLOSING')
    return [...this.tracked].filter(id => !this.failures.has(id)).sort()
  }
  close() {
    if (this.pendingClose) return this.pendingClose
    this.closing = true
    for (const provider of this.providers) if ('close' in provider && typeof provider.close === 'function') provider.close()
    this.pendingClose = Promise.allSettled([...this.tracked].map(id => this.service.close(id))).then(results => {
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
      if (failures.length) throw new AggregateError(failures, 'Collaboration stores failed to close')
    })
    return this.pendingClose
  }
}
