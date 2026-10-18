import { CollabError, CollabService, FileStore, principals, type ChannelProvider } from 'collab-kernel'
import { validateConfig, type HostConfig } from './config.js'
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
  static async create(config: HostConfig, workspaces: readonly string[], providers: ChannelProvider[], onCreated?: (host: CollabHost) => void) {
    const valid = await validateConfig(config, workspaces)
    const host = new CollabHost(valid, new FileStore(valid.dataDir), providers)
    try {
      onCreated?.(host)
      for (const id of await host.store.list()) {
        if (host.closing) break
        host.admissionCheck?.()
        host.tracked.add(id)
        try { await host.service.open(id) } catch (error) { host.failures.set(id, error) }
      }
      return host
    } catch (error) { await host.close(); throw error }
  }
  context(id: string, spaceId: string, cmdId?: string) { return { principal: principals.agent({ channel: 'dsh-session', address: id }), spaceId, cmdId: cmdId! } }
  admissionCheck?: () => void
  private gate(spaceId: string) {
    this.admissionCheck?.()
    if (this.closing) throw new CollabError('COLLAB_SERVICE_CLOSING')
    if (this.failures.has(spaceId)) throw this.failures.get(spaceId)
  }
  async command<T>(_caller: string, spaceId: string, _cmdId: string, run: (service: CollabService) => Promise<T>): Promise<T> {
    this.gate(spaceId)
    this.tracked.add(spaceId)
    return run(this.service)
  }
  async read<T>(_caller: string, spaceId: string, run: (service: CollabService) => Promise<T>): Promise<T> {
    this.gate(spaceId)
    return run(this.service)
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
