import type { FederatedSessionId, NodeId, SearchResult } from '../../core/index.js'

export const SEARCH_DEBOUNCE_MS = 250
export const SEARCH_RESULT_LIMIT = 20

export interface NodeSearchOutcome {
  readonly nodeId: NodeId
  readonly results: readonly SearchResult[]
  readonly failed: boolean
  readonly diagnostic?: string
}

export interface FederatedSearchRow {
  readonly sessionId: FederatedSessionId
  readonly nodeId: NodeId
  readonly nodeDisplayName: string
  readonly workspaceTitle?: string
  readonly sessionTitle: string
  readonly snippet?: string
  /** Metadata hits (title/path) rank above content-only hits. */
  readonly matchedMetadata: boolean
}

export interface FederatedSearchResult {
  readonly rows: readonly FederatedSearchRow[]
  readonly hasMore: boolean
  readonly failedNodes: readonly { readonly nodeId: NodeId; readonly diagnostic: string }[]
}

export interface SearchContext {
  nodeDisplayName(nodeId: NodeId): string
  workspaceTitle(sessionId: FederatedSessionId): string | undefined
}

function matchesMetadata(query: string, row: { title: string; path: string }): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return false
  return row.title.toLowerCase().includes(needle) || row.path.toLowerCase().includes(needle)
}

/**
 * Merges per-node search outcomes into one central list. Node failures never
 * discard another node's successful results; they surface as warnings.
 */
export function mergeSearchOutcomes(query: string, outcomes: readonly NodeSearchOutcome[], context: SearchContext): FederatedSearchResult {
  const rows: FederatedSearchRow[] = []
  const failedNodes: { nodeId: NodeId; diagnostic: string }[] = []
  for (const outcome of outcomes) {
    if (outcome.failed) {
      failedNodes.push({ nodeId: outcome.nodeId, diagnostic: outcome.diagnostic ?? 'search failed' })
      continue
    }
    for (const result of outcome.results) {
      rows.push({
        sessionId: result.session.id,
        nodeId: outcome.nodeId,
        nodeDisplayName: context.nodeDisplayName(outcome.nodeId),
        ...(context.workspaceTitle(result.session.id) === undefined ? {} : { workspaceTitle: context.workspaceTitle(result.session.id)! }),
        sessionTitle: result.session.title,
        ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
        matchedMetadata: matchesMetadata(query, { title: result.session.title, path: result.session.path }),
      })
    }
  }
  rows.sort((a, b) => Number(b.matchedMetadata) - Number(a.matchedMetadata)
    || a.nodeDisplayName.localeCompare(b.nodeDisplayName)
    || a.sessionTitle.localeCompare(b.sessionTitle)
    || a.sessionId.localeCompare(b.sessionId))
  return Object.freeze({
    rows: Object.freeze(rows.slice(0, SEARCH_RESULT_LIMIT)),
    hasMore: rows.length > SEARCH_RESULT_LIMIT,
    failedNodes: Object.freeze(failedNodes),
  })
}

export interface SearchCoordinatorOptions {
  readonly debounceMs?: number
  readonly perNodeTimeoutMs?: number
  searchNode(nodeId: NodeId, query: string, signal: AbortSignal): Promise<readonly SearchResult[]>
  readonly context: SearchContext
}

/**
 * Debounced, per-node-isolated search. A superseding query aborts the previous
 * round, and one slow or failing node can never block the others.
 */
export class FederatedSearchCoordinator {
  readonly #options: Required<Pick<SearchCoordinatorOptions, 'debounceMs' | 'perNodeTimeoutMs'>> & SearchCoordinatorOptions
  #timer: ReturnType<typeof setTimeout> | undefined
  #inflight: AbortController | undefined

  constructor(options: SearchCoordinatorOptions) {
    this.#options = {
      ...options,
      debounceMs: options.debounceMs ?? SEARCH_DEBOUNCE_MS,
      perNodeTimeoutMs: options.perNodeTimeoutMs ?? 5_000,
    }
  }

  /** Debounces, then queries every node concurrently. */
  search(query: string, nodeIds: readonly NodeId[]): Promise<FederatedSearchResult> {
    this.cancel()
    return new Promise((resolve, reject) => {
      this.#timer = setTimeout(() => {
        this.#timer = undefined
        this.#run(query, nodeIds).then(resolve, reject)
      }, this.#options.debounceMs)
    })
  }

  cancel(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#inflight?.abort(new Error('search superseded'))
    this.#inflight = undefined
  }

  async #run(query: string, nodeIds: readonly NodeId[]): Promise<FederatedSearchResult> {
    const controller = new AbortController()
    this.#inflight = controller
    const outcomes = await Promise.all(nodeIds.map(async nodeId => {
      const nodeController = new AbortController()
      const onAbort = () => nodeController.abort(controller.signal.reason)
      controller.signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => nodeController.abort(new Error('node search timed out')), this.#options.perNodeTimeoutMs)
      try {
        return { nodeId, results: await this.#options.searchNode(nodeId, query, nodeController.signal), failed: false } satisfies NodeSearchOutcome
      } catch (cause) {
        return { nodeId, results: [], failed: true, diagnostic: cause instanceof Error ? cause.message : 'search failed' } satisfies NodeSearchOutcome
      } finally {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', onAbort)
      }
    }))
    if (this.#inflight === controller) this.#inflight = undefined
    return mergeSearchOutcomes(query, outcomes, this.#options.context)
  }
}
