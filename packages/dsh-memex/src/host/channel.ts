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
import { existsSync, readdirSync, rmSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  MEMEX_BROWSE_ENDPOINT,
  MEMEX_CHANNEL,
  MEMEX_DELETE_ENDPOINT,
  MEMEX_REMOTE_ENDPOINT,
  MEMEX_RESOLVE_ENDPOINT,
  MEMEX_STORES_ENDPOINT,
  MEMEX_WORKSPACES_ENDPOINT,
  type MemexBrowseRequest,
  type MemexDeleteRequest,
  type MemexDeleteResult,
  type MemexBrowseResult,
  type MemexKernelView,
  type MemexOffSource,
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
import type { BrowseRegistry } from '../run/browse-registry.js'
import { mapConcurrent } from '../run/concurrency.js'
import { installedKernelVersion, runKernel } from '../run/kernel.js'
import { assertLibraryTarget, assertRetirable, moveLibrary, normalizeLibraryPath } from '../scope/library-move.js'
import { parseSyncStatus } from '../run/sync-status.js'
import { KERNEL_VERSION } from '../tools/descriptions.generated.js'
import type { OffSource, ScopeConfig, ScopeResolution, ScopeService } from '../scope/types.js'

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
  readonly evalDispatch?: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
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
  /**
   * Browse-service registry. Absent means card browsing is not composed, and
   * the endpoint refuses rather than pretending a service could start.
   */
  readonly browse?: BrowseRegistry
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
  /**
   * Libraries moved in this Host's lifetime but not yet retired.
   *
   * A move is two steps: copy + kernel work (here), then the page persists the
   * new home, then the old directory may be deleted. Only a directory named here
   * — and only once the configuration points at its target — is ever deleted.
   */
  const pendingRetire = new Map<string, { readonly from: string; readonly to: string }>()

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

  /** Field-by-field copy, so nothing beyond the contract reaches the browser. */
  const copyOffSource = (source: OffSource): MemexOffSource =>
    source.kind === 'workspace' ? { kind: 'workspace', path: source.path } : { kind: 'entry', scope: source.scope }

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
      fallback: resolution.fallback,
      personal: { read: resolution.personal.read, write: resolution.personal.write },
      claim: resolution.claim.kind === 'path' ? { kind: 'path', prefix: resolution.claim.prefix } : { kind: resolution.claim.kind },
      offBy: {
        memory: resolution.offBy.memory.map(copyOffSource),
        fallback: resolution.offBy.fallback.map(copyOffSource),
      },
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

  /**
   * Ensure one library's browse service and report its bound port.
   *
   * Refusals are ordered so that nothing is started for a library that is not
   * allowed to be browsed: the memory-off check runs BEFORE any spawn, mirroring
   * the tool path's "reject before ensure" rule — otherwise a workspace that
   * deliberately has no memory would get a live server on first click.
   */
  const runBrowse = async (params: unknown): Promise<MemexBrowseResult> => {
    const request = params as MemexBrowseRequest | undefined
    if (request === undefined || typeof request.scope !== 'string' || request.scope === '') {
      throw new Error('browse requires a scope')
    }
    // resolveByName is pure: an unknown scope is answered, not materialized.
    const target = options.scopes.resolveByName(request.scope)
    if (!target.memory) {
      return {
        status: 'refused',
        reason: 'memory-off',
        message: `Memory is off for the workspaces routed to ${request.scope}; turn it back on in Settings → 记忆 to browse its cards.`,
      }
    }
    if (!existsSync(join(target.home, 'cards'))) {
      return {
        status: 'refused',
        reason: 'not-materialized',
        message: `Library ${request.scope} has no cards directory yet, so there is nothing to browse.`,
      }
    }
    if (options.browse === undefined) {
      return {
        status: 'refused',
        reason: 'kernel-unavailable',
        message: 'Card browsing is not available in this deployment.',
      }
    }
    try {
      const service = await options.browse.ensure(target.home)
      return { status: 'ok', port: service.port, scope: request.scope }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        status: 'refused',
        reason: /not found|Expected @touchskyer|does not declare/i.test(detail) ? 'kernel-unavailable' : 'start-failed',
        message: summarize(detail) ?? 'Could not start the card browser for this library.',
      }
    }
  }

  /**
   * Delete one library no configured entry declares.
   *
   * Deleting a directory is the only irreversible thing this channel can do, so
   * the proof is narrow: the name must be a *discovered* library — a directory
   * under the namespace carrying cards and no declaring entry — and its home must
   * be exactly `<namespace>/<name>`. A library the configuration knows about, or
   * one some workspace resolves to, is refused even when it looks unused.
   */
  const runDelete = (params: unknown): MemexDeleteResult => {
    const request = params as MemexDeleteRequest | undefined
    if (request === undefined || typeof request.scope !== 'string' || request.scope.trim() === '') {
      throw new Error('delete requires a scope')
    }
    const scope = request.scope.trim()
    const target = options.scopes.resolveByName(scope)
    const cards = countMarkdownFiles(join(target.home, 'cards'))
    const refuse = (reason: NonNullable<MemexDeleteResult['reason']>, message: string): MemexDeleteResult =>
      ({ status: 'refused', home: target.home, cards, reason, message })
    if (options.config().scopes.some(entry => entry.name === scope)) {
      return refuse('declared', `${scope} is declared in the configuration; remove the entry instead of deleting its cards.`)
    }
    if (target.source !== 'discovered') {
      return refuse('not-discovered', `${scope} is not an undeclared library under the namespace, so it cannot be deleted here.`)
    }
    const namespace = normalizeLibraryPath(namespaceDir)
    const expected = join(namespace, scope)
    if (normalizeLibraryPath(target.home) !== expected) {
      return refuse('outside-namespace', `${target.home} is not the namespace directory for ${scope}.`)
    }
    const inUse = options.scopes.list().filter(resolution =>
      resolution.scope !== scope && normalizeLibraryPath(resolution.home) === expected)
    if (inUse.length > 0) {
      return refuse('busy', `${inUse.map(resolution => resolution.scope).join(', ')} still resolves to ${expected}.`)
    }
    try {
      rmSync(expected, { recursive: true, force: true })
      return { status: 'ok', home: expected, cards }
    } catch (error) {
      return refuse('failed', error instanceof Error ? error.message : String(error))
    }
  }

  /** Turn one kernel result into the channel's answer shape. */
  const remoteAnswer = (result: { readonly ok: boolean; readonly stdout: string; readonly stderr: string; readonly exitCode: number }, args: readonly string[]): MemexRemoteResult => {
    const output = summarize(result.stdout)
    if (result.ok) return { status: 'ok', ...(output !== undefined ? { output } : {}) }
    return {
      status: 'failed',
      ...(output !== undefined ? { output } : {}),
      message: summarize(result.stderr) ?? `memex ${args.join(' ')} failed (exit ${result.exitCode})`,
    }
  }

  /**
   * Delete a moved library's old directory, once the configuration proves the move.
   *
   * The page persists the new home between the move and this call, so the check
   * here is what makes the deletion safe: the scope must now resolve to the move's
   * target, and the directory must be one this Host itself just moved.
   */
  const retireLibrary = (scope: string): MemexRemoteResult => {
    const pending = pendingRetire.get(scope)
    if (pending === undefined) throw new Error(`no move is pending for ${scope}`)
    // The move may have renamed the library, so the proof is that *some* scope now
    // resolves to the target directory — not that this name still exists.
    const homes = options.scopes.list().map(resolution => normalizeLibraryPath(resolution.home))
    if (!homes.includes(pending.to)) {
      throw new Error(`refusing to delete ${pending.from}: no library resolves to ${pending.to} yet`)
    }
    assertRetirable(pending.from, options.scopes.list().map(resolution => resolution.home))
    rmSync(pending.from, { recursive: true, force: true })
    pendingRetire.delete(scope)
    return { status: 'ok', output: `retired ${pending.from}` }
  }

  const runRemote = async (params: unknown): Promise<MemexRemoteResult> => {
    const request = params as MemexRemoteRequest | undefined
    if (request === undefined || typeof request.scope !== 'string') throw new Error('remote requires a scope')
    // resolveByName is pure: an unknown scope is answered, not materialized.
    const target = options.scopes.resolveByName(request.scope)
    if (request.action === 'retire') return retireLibrary(request.scope)

    const requested = request.home?.trim() ?? ''
    if (requested === '') {
      const args = actionArgs(request)
      return remoteAnswer(await runner(args, { home: target.home, requireCards: false, timeoutMs: 120_000 }), args)
    }

    // Move first, then let the kernel work in the new directory: a failure on
    // either side leaves the old library in place and unregistered for retirement.
    assertLibraryTarget(target.home, requested)
    const report = moveLibrary(target.home, requested)
    const args = request.action === 'init' && (request.url?.trim() ?? '') !== '' ? actionArgs(request) : ['sync']
    const result = await runner(args, { home: report.to, requireCards: false, timeoutMs: 120_000 })
    const answer = remoteAnswer(result, args)
    if (answer.status !== 'ok') return answer
    pendingRetire.set(request.scope, { from: report.from, to: report.to })
    return { ...answer, moved: { from: report.from, to: report.to } }
  }

  ctx.inject(['connection'], child => {
    const connection = child.get('connection')
    if (connection === undefined) return
    child.effect(() => connection.rpc.handle(
      MEMEX_CHANNEL,
      async (endpoint: string, params: unknown, signal: AbortSignal): Promise<RpcOk | RpcFail> => {
        try {
          if (endpoint.startsWith('eval/') && options.evalDispatch) {
            if (!(signal instanceof AbortSignal)) return fail('eval requires a carrier cancellation signal')
            return { ok: true, value: await options.evalDispatch(endpoint, params, signal) }
          }
          if (endpoint === MEMEX_STORES_ENDPOINT) return { ok: true, value: await buildStores() }
          if (endpoint === MEMEX_RESOLVE_ENDPOINT) return { ok: true, value: resolvePath(params) }
          if (endpoint === MEMEX_WORKSPACES_ENDPOINT) return { ok: true, value: listWorkspaces() }
          if (endpoint === MEMEX_REMOTE_ENDPOINT) return { ok: true, value: await runRemote(params) }
          if (endpoint === MEMEX_DELETE_ENDPOINT) return { ok: true, value: runDelete(params) }
          if (endpoint === MEMEX_BROWSE_ENDPOINT) return { ok: true, value: await runBrowse(params) }
          return fail(`unknown endpoint "${endpoint}"`)
        } catch (error) {
          return fail(`${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    ), 'dsh-memex: /dsh-memex rpc channel')
  })
}

export type { MemexRemoteAction }
