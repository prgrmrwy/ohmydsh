/**
 * Registry of running browse services, keyed by library directory.
 *
 * One library, one process — that is the kernel's own granularity
 * (`MEMEX_HOME`) and therefore also the isolation boundary: a service can only
 * ever read the library it was started for.
 *
 * Services start on demand, never at plugin startup, and are all stopped when
 * the plugin stops. There is no idle reaping: "idle" would have to be defined
 * against browser tabs the Host cannot observe, so the conservative rule is to
 * keep a started service until the plugin goes away.
 *
 * @module dsh-memex/run/browse-registry
 */
import { startBrowseService, type BrowseService, type StartBrowseServiceOptions } from './browse-service.js'

export type BrowseServiceStarter = (options: StartBrowseServiceOptions) => Promise<BrowseService>

export interface BrowseRegistryOptions {
  /** Test-only starter override. */
  readonly start?: BrowseServiceStarter
}

export interface BrowseRegistry {
  /**
   * Return the live service for a library, starting one if needed.
   *
   * Concurrent callers for the same library share one in-flight start, so a
   * double click cannot produce two processes for one library.
   */
  ensure(home: string): Promise<BrowseService>
  /** Stop and forget every running service. */
  stopAll(): Promise<void>
  /** Live services, for diagnostics and tests. */
  running(): readonly BrowseService[]
}

export function createBrowseRegistry(options: BrowseRegistryOptions = {}): BrowseRegistry {
  const start = options.start ?? startBrowseService
  /** Pending or settled starts, keyed by library home. */
  const entries = new Map<string, Promise<BrowseService>>()
  const live = new Map<string, BrowseService>()
  let stopped = false

  const ensure = async (home: string): Promise<BrowseService> => {
    if (stopped) throw new Error('browse registry is stopped')
    const existing = entries.get(home)
    if (existing !== undefined) return await existing

    const pending = start({ home })
      .then(service => {
        // A stop that lands while this start was in flight must win, otherwise
        // the process outlives the plugin that owns it.
        if (stopped) {
          void service.stop()
          throw new Error('browse registry is stopped')
        }
        live.set(home, service)
        return service
      })
      .catch(error => {
        // Failed starts must not be cached: the next request should retry
        // rather than replay a stale failure forever.
        entries.delete(home)
        throw error
      })

    entries.set(home, pending)
    return await pending
  }

  const stopAll = async (): Promise<void> => {
    stopped = true
    const services = [...live.values()]
    live.clear()
    entries.clear()
    await Promise.all(services.map(service => service.stop().catch(() => undefined)))
  }

  return {
    ensure,
    stopAll,
    running: () => [...live.values()],
  }
}
