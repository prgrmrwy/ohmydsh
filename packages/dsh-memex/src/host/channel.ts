/**
 * The `/dsh-memex` settings channel (host half).
 *
 * Answers the browser with facts it cannot obtain itself, and performs the one
 * class of mutating action the settings page owns: remote configuration
 * delegated to the kernel CLI. Read endpoints never create anything.
 *
 * Boundary: like every other channel in this deployment, loopback/authentication
 * is enforced by the Connection layer for all channels, so no per-channel
 * `authority` option is declared (0.1.2 removed it).
 *
 * @module dsh-memex/host/channel
 */
import { existsSync, readdirSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  MEMEX_CHANNEL,
  MEMEX_REMOTE_ENDPOINT,
  MEMEX_RESOLVE_ENDPOINT,
  MEMEX_STORES_ENDPOINT,
  MEMEX_WORKSPACES_ENDPOINT,
  type MemexKernelView,
  type MemexRemoteAction,
  type MemexRemoteRequest,
  type MemexRemoteResult,
  type MemexResolveResult,
  type MemexStoresResult,
  type MemexStoreSync,
  type MemexStoreView,
  type MemexWorkspaceView,
  type MemexWorkspacesResult,
} from '../contract.js'
import { mapConcurrent } from '../run/concurrency.js'
import { installedKernelVersion, runKernel } from '../run/kernel.js'
import { parseSyncStatus } from '../run/sync-status.js'
import { KERNEL_VERSION } from '../tools/descriptions.generated.js'
import type { ScopeConfig, ScopeResolution, ScopeService } from '../scope/types.js'

/** Sampling concurrency: the page opens rarely, but never stampede the kernel. */
const SAMPLE_CONCURRENCY = 4
/** Bound on the kernel text we hand back, so one failure cannot flood the page. */
const MAX_MESSAGE_CHARS = 2_000
/** Bound on the card walk, so a pathological library cannot stall the page. */
const MAX_COUNTED_FILES = 5_000
const MAX_COUNT_DEPTH = 4

/**
 * The scope surface the channel is allowed to touch.
 *
 * `ensure` is deliberately absent: the channel must be unable to create a
 * library, so a mis-wired endpoint cannot turn a page load into a filesystem
 * write.
 */
export type ChannelScopeService = Pick<ScopeService, 'resolve' | 'list' | 'resolveByName' | 'bindingFor' | 'accessFor'>

export interface MemexChannelOptions {
  readonly scopes: ChannelScopeService
  /** Latest validated settings section; read per call so live edits show up. */
  readonly config: () => ScopeConfig
  /** Kernel runner override (tests only). */
  readonly runner?: typeof runKernel
  /** Installed-version probe override (tests only). */
  readonly installedVersion?: () => string | undefined
  /** Namespace directory, for reporting only. */
  readonly namespaceDir?: string
  /** Home directory used to expand configured `~/…` prefixes for the browser. */
  readonly homeDir?: string
  /** Degradation reporter; the workspace registry is an optional peer. */
  readonly onWarn?: (message: string) => void
}

/** The slice of a host workspace this channel reads. */
export interface WorkspaceEntry {
  readonly id: string
  readonly title: string
  readonly path: string
}

interface RpcOk { readonly ok: true; readonly value: unknown }
interface RpcFail { readonly ok: false; readonly error: { readonly code: 'internal'; readonly message: string; readonly details: Record<string, never> } }

function fail(message: string): RpcFail {
  return { ok: false, error: { code: 'internal', message: `dsh-memex: ${message}`, details: {} } }
}

function summarize(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return trimmed.length > MAX_MESSAGE_CHARS ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…` : trimmed
}

/** Count markdown files under one directory without following depth forever. */
export function countMarkdownFiles(dir: string): number {
  if (!existsSync(dir)) return 0
  let count = 0
  const walk = (current: string, depth: number): void => {
    if (depth > MAX_COUNT_DEPTH || count >= MAX_COUNTED_FILES) return
    let entries: Dirent[]
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (count >= MAX_COUNTED_FILES) return
      if (entry.isDirectory()) walk(join(current, entry.name), depth + 1)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) count += 1
    }
  }
  walk(dir, 0)
  return count
}

function kernelView(installed: string | undefined): MemexKernelView {
  return {
    expected: KERNEL_VERSION,
    ...(installed !== undefined ? { version: installed } : {}),
    matches: installed === KERNEL_VERSION,
  }
}

/**
 * Register the channel when a host connection exists.
 * @param ctx - the plugin context (a child fiber is created for the channel).
 * @param options - scope surface, live settings and kernel access.
 */
export function registerMemexChannel(ctx: Context, options: MemexChannelOptions): void {
  const runner = options.runner ?? runKernel
  const probeVersion = options.installedVersion ?? installedKernelVersion
  const namespaceDir = options.namespaceDir ?? join(process.env.HOME ?? '', '.dsh-memex')

  /** Sample one library's sync state; a failure degrades that row only. */
  const sampleSync = async (resolution: ScopeResolution): Promise<MemexStoreSync> => {
    try {
      const result = await runner(['sync', '--status'], { home: resolution.home, requireCards: false, timeoutMs: 15_000 })
      if (result.exitCode === 124) return { known: false, degraded: 'timeout' }
      const parsed = parseSyncStatus(result.ok ? result.stdout : `${result.stdout}\n${result.stderr}`)
      if (!parsed.configured) return { known: true, configured: false }
      return {
        known: true,
        configured: true,
        ...(parsed.remote !== undefined ? { remote: parsed.remote } : {}),
        ...(parsed.adapter !== undefined ? { adapter: parsed.adapter } : {}),
        ...(parsed.auto !== undefined ? { auto: parsed.auto } : {}),
        ...(parsed.lastSync !== undefined ? { lastSync: parsed.lastSync } : {}),
      }
    } catch (error) {
      const code = (error as { code?: string }).code
      return { known: false, degraded: typeof code === 'string' ? code : 'unavailable' }
    }
  }

  const buildStores = async (): Promise<MemexStoresResult> => {
    const declared = new Map(options.config().scopes.map(entry => [entry.name, entry]))
    const resolutions = [...options.scopes.list()].sort((a, b) => a.scope.localeCompare(b.scope))
    const stores = await mapConcurrent(resolutions, SAMPLE_CONCURRENCY, async (resolution): Promise<MemexStoreView> => {
      const entry = declared.get(resolution.scope)
      const cardsDir = join(resolution.home, 'cards')
      const exists = existsSync(cardsDir)
      return {
        scope: resolution.scope,
        home: resolution.home,
        homeSource: resolution.homeSource,
        publish: resolution.publish,
        publishKnown: resolution.publishKnown,
        source: resolution.source,
        declared: entry !== undefined,
        primary: entry?.primary === true,
        memory: entry?.memory !== false,
        exists,
        ...(exists ? { cards: countMarkdownFiles(cardsDir) } : {}),
        ...(exists ? { archive: countMarkdownFiles(join(resolution.home, 'archive')) } : {}),
        pathPrefixes: entry?.pathPrefixes ?? resolution.workspacePaths,
        remotePatterns: entry?.remotePatterns ?? [],
        sync: await sampleSync(resolution),
      }
    })
    return { kernel: kernelView(probeVersion()), namespaceDir, stores }
  }

  /** Pure: answers for directories that do not exist, and creates nothing. */
  const resolvePath = (params: unknown): MemexResolveResult => {
    const path = (params as { path?: unknown } | undefined)?.path
    if (typeof path !== 'string' || path.trim() === '') throw new Error('resolve requires a path')
    const resolution = options.scopes.resolve(path)
    return {
      path,
      scope: resolution.scope,
      home: resolution.home,
      publish: resolution.publish,
      publishKnown: resolution.publishKnown,
      memory: resolution.memory,
      source: resolution.source,
      exists: existsSync(join(resolution.home, 'cards')),
      local: resolution.source === 'local',
    }
  }

  /**
   * Pure read: the host's own workspaces, each with the route its directory takes.
   *
   * The workspace registry is an optional peer — `ctx.get` reads it without an
   * injection requirement, and its absence is reported as `known: false` rather
   * than as an empty list, so the page can degrade to the configuration-only
   * shape instead of telling the user they have no workspaces.
   *
   * Resolution is the same pure `resolve` the page's path probe uses: it answers
   * for directories that do not exist and creates nothing.
   */
  const listWorkspaces = (): MemexWorkspacesResult => {
    const homeDir = options.homeDir ?? homedir()
    const registry = readWorkspaceRegistry()
    if (registry === undefined) return { known: false, homeDir, items: [] }
    const items = registry.map((entry): MemexWorkspaceView => {
      const route = safeResolve(entry.path)
      return {
        id: entry.id,
        title: entry.title,
        path: entry.path,
        ...(route === undefined ? {} : { route }),
      }
    })
    return { known: true, homeDir, items }
  }

  const readWorkspaceRegistry = (): readonly WorkspaceEntry[] | undefined => {
    let service: { list?: () => readonly WorkspaceEntry[] } | undefined
    try {
      // Without an injection requirement: an unavailable peer is a normal state,
      // not a wiring error, and this endpoint is the only consumer.
      service = ctx.get('workspaceRegistry') as { list?: () => readonly WorkspaceEntry[] } | undefined
    } catch { return undefined }
    if (service === undefined || typeof service.list !== 'function') return undefined
    try {
      return service.list().map(entry => ({ id: String(entry.id), title: String(entry.title), path: String(entry.path) }))
    } catch (error) {
      options.onWarn?.(`workspaces unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  const safeResolve = (path: string): MemexResolveResult | undefined => {
    try { return resolvePath({ path }) } catch { return undefined }
  }

  const actionArgs = (request: MemexRemoteRequest): readonly string[] => {
    switch (request.action) {
      case 'init': {
        const url = request.url?.trim() ?? ''
        if (url === '') throw new Error('init requires the remote URL to configure')
        return ['sync', '--init', url]
      }
      case 'sync': return ['sync']
      case 'push': return ['sync', 'push']
      case 'pull': return ['sync', 'pull']
      case 'auto-on': return ['sync', 'on']
      case 'auto-off': return ['sync', 'off']
      default: throw new Error(`unknown remote action: ${String((request as { action?: unknown }).action)}`)
    }
  }

  const runRemote = async (params: unknown): Promise<MemexRemoteResult> => {
    const request = params as MemexRemoteRequest | undefined
    if (request === undefined || typeof request.scope !== 'string') throw new Error('remote requires a scope')
    const args = actionArgs(request)
    // resolveByName is pure: an unknown scope is answered, not materialized.
    const target = options.scopes.resolveByName(request.scope)
    const result = await runner(args, { home: target.home, requireCards: false, timeoutMs: 120_000 })
    if (result.ok) {
      return { status: 'ok', ...(summarize(result.stdout) !== undefined ? { output: summarize(result.stdout)! } : {}) }
    }
    return {
      status: 'failed',
      ...(summarize(result.stdout) !== undefined ? { output: summarize(result.stdout)! } : {}),
      message: summarize(result.stderr) ?? `memex ${args.join(' ')} failed (exit ${result.exitCode})`,
    }
  }

  ctx.inject(['connection'], child => {
    const connection = child.get('connection')
    if (connection === undefined) return
    child.effect(() => connection.rpc.handle(
      MEMEX_CHANNEL,
      async (endpoint: string, params?: unknown): Promise<RpcOk | RpcFail> => {
        try {
          if (endpoint === MEMEX_STORES_ENDPOINT) return { ok: true, value: await buildStores() }
          if (endpoint === MEMEX_RESOLVE_ENDPOINT) return { ok: true, value: resolvePath(params) }
          if (endpoint === MEMEX_WORKSPACES_ENDPOINT) return { ok: true, value: listWorkspaces() }
          if (endpoint === MEMEX_REMOTE_ENDPOINT) return { ok: true, value: await runRemote(params) }
          return fail(`unknown endpoint "${endpoint}"`)
        } catch (error) {
          return fail(`${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    ), 'dsh-memex: /dsh-memex rpc channel')
  })
}

export type { MemexRemoteAction }
