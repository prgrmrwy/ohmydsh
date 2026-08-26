import type { NodeId } from '../../core/index.js'

export interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly hidden: boolean
}

export interface DirectoryLevel {
  readonly path: string
  readonly home: string
  readonly crumbs: readonly DirectoryEntry[]
  readonly entries: readonly DirectoryEntry[]
  readonly truncated: boolean
}

export type DirectoryFlowMode = 'native' | 'browse'

export type DirectoryFlowPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly path?: string }
  | { readonly kind: 'ready'; readonly level: DirectoryLevel }
  | { readonly kind: 'error'; readonly message: string; readonly retryPath?: string }

export interface DirectoryFlowPort {
  listDirectory(nodeId: NodeId, path: string | undefined, signal?: AbortSignal): Promise<DirectoryLevel>
  createDirectory(nodeId: NodeId, path: string, name: string, signal?: AbortSignal): Promise<{ readonly path: string }>
}

export interface DirectoryFlowOptions {
  readonly nodeId: NodeId
  /** Remote nodes always browse in-app; This Mac may use its own native chooser. */
  readonly mode: DirectoryFlowMode
  readonly port: DirectoryFlowPort
  readonly showHidden?: boolean
}

/**
 * Node-bound directory flow. Every request carries the owning node id, a failure
 * stays retryable instead of falling back to the central filesystem, and folder
 * creation is a single level under an existing parent.
 */
export class NodeDirectoryFlow {
  #phase: DirectoryFlowPhase = { kind: 'idle' }
  #showHidden: boolean
  readonly #options: DirectoryFlowOptions

  constructor(options: DirectoryFlowOptions) {
    this.#options = options
    this.#showHidden = options.showHidden ?? false
  }

  get nodeId(): NodeId { return this.#options.nodeId }
  get mode(): DirectoryFlowMode { return this.#options.mode }
  get phase(): DirectoryFlowPhase { return this.#phase }
  get showHidden(): boolean { return this.#showHidden }

  /** Remote nodes never expose a native chooser affordance. */
  get usesNativeChooser(): boolean { return this.#options.mode === 'native' }

  setShowHidden(value: boolean): void { this.#showHidden = value }

  visibleEntries(): readonly DirectoryEntry[] {
    if (this.#phase.kind !== 'ready') return []
    return this.#phase.level.entries.filter(entry => this.#showHidden || !entry.hidden)
  }

  async open(path?: string, signal?: AbortSignal): Promise<DirectoryFlowPhase> {
    this.#phase = path === undefined ? { kind: 'loading' } : { kind: 'loading', path }
    try {
      const level = await this.#options.port.listDirectory(this.#options.nodeId, path, signal)
      this.#phase = { kind: 'ready', level }
    } catch (cause) {
      this.#phase = {
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'directory listing failed',
        ...(path === undefined ? {} : { retryPath: path }),
      }
    }
    return this.#phase
  }

  /** Retries the exact previous target; a disconnect keeps the modal usable. */
  retry(signal?: AbortSignal): Promise<DirectoryFlowPhase> {
    const retryPath = this.#phase.kind === 'error' ? this.#phase.retryPath : undefined
    return this.open(retryPath, signal)
  }

  async createChild(name: string, signal?: AbortSignal): Promise<DirectoryFlowPhase> {
    if (this.#phase.kind !== 'ready') return { kind: 'error', message: 'no listed parent directory' }
    if (name === '' || name.includes('/') || name.includes('\0') || name === '.' || name === '..') {
      this.#phase = { kind: 'error', message: 'folder name must be a single path segment', retryPath: this.#phase.level.path }
      return this.#phase
    }
    const parent = this.#phase.level.path
    try {
      const created = await this.#options.port.createDirectory(this.#options.nodeId, parent, name, signal)
      return await this.open(created.path, signal)
    } catch (cause) {
      this.#phase = {
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'folder creation failed',
        retryPath: parent,
      }
      return this.#phase
    }
  }
}
