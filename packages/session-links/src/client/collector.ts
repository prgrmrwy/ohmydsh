/**
 * Per-session link collection: subscribes to the official conversation
 * snapshot, ingests only messages past a monotonic seq watermark (one full
 * scan per session at most), dedupes URLs keeping the latest occurrence,
 * and notifies subscribers on a debounced emit.
 *
 * All state lives in the browser; nothing is persisted and nothing leaves
 * the page. The store is owned by the plugin fiber and disposed with it.
 */
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { collectLinksFromNode, compareEntries, type LinkEntry } from '../shared/links.js'
import type { ProducedFile } from '../shared/produced.js'
import { compareProduced, producedFromNode } from './produces.js'

/** The narrow observable face of a session's conversation snapshot. */
export interface SnapshotSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): ConversationSnapshot
}

/** Debounce window for subscriber notification (ingest is cheap; renders are not). */
const NOTIFY_DEBOUNCE_MS = 150

class SessionLinksState {
  /** Highest `seq` already ingested (monotonic watermark; loadOlder adds only older seqs). */
  private maxSeen = -1
  /** URL -> latest occurrence (dedup keeps the latest, counts repetitions). */
  private readonly byUrl = new Map<string, LinkEntry>()
  /** Live source subscription; null when no source has been attached yet. */
  private unsubscribe: (() => void) | null = null
  /** Stable sorted projection; rebuilt only when dirty (React identity contract). */
  private sorted: readonly LinkEntry[] = EMPTY_ENTRIES
  private sortedDirty = false
  /** Host baseline applied once; later applications are ignored. */
  private baselineApplied = false
  /** Produced files, path -> first-seen entry (a file written and edited once stays one entry). */
  private readonly producedByPath = new Map<string, ProducedFile>()
  /** Stable sorted produced projection (React identity contract). */
  private producedSorted: readonly ProducedFile[] = EMPTY_PRODUCED
  private producedDirty = false

  constructor(source: SnapshotSource | undefined, private readonly changed: () => void) {
    this.upgradeSource(source)
  }

  /**
   * Apply the host whole-log baseline: every entry lands as-is (the host
   * already deduped and counted), the watermark jumps to the log's highest
   * seq, and later snapshot increments continue from there. Idempotent:
   * re-applying the same baseline is a no-op (the panel stays stable).
   */
  applyBaseline(entries: readonly LinkEntry[], produced: readonly ProducedFile[], maxSeq: number): void {
    if (this.baselineApplied) return
    this.baselineApplied = true
    for (const entry of entries) this.byUrl.set(entry.url, entry)
    for (const file of produced) {
      if (!this.producedByPath.has(file.path)) {
        this.producedByPath.set(file.path, file)
        this.producedDirty = true
      }
    }
    this.sortedDirty = true
    if (maxSeq > this.maxSeen) this.maxSeen = maxSeq
    this.changed()
  }

  /**
   * Attach a real source to this state. Idempotent: no-op once attached
   * (re-attaching would double-ingest the watermark and churn listeners).
   * This is also the path for upgrading a source-less state when the
   * binding becomes available later.
   */
  upgradeSource(source: SnapshotSource | undefined): void {
    if (this.unsubscribe !== null || !source) return
    this.ingest(source.getSnapshot())
    this.sortedDirty = true
    this.unsubscribe = source.subscribe(() => {
      this.ingest(source.getSnapshot())
      this.changed()
    })
  }

  private ingest(snap: ConversationSnapshot): void {
    let max = this.maxSeen
    for (const node of snap.nodes) {
      if (node.seq <= this.maxSeen) continue
      if (node.seq > max) max = node.seq
      for (const entry of collectLinksFromNode(node)) this.upsert(entry)
      if (node.kind === 'tool-result') {
        for (const produced of producedFromNode(node)) {
          const prev = this.producedByPath.get(produced.path)
          // First-seen wins (official semantics: written-then-edited = one entry).
          if (prev === undefined) {
            this.producedByPath.set(produced.path, produced)
            this.producedDirty = true
          }
        }
      }
    }
    if (max > this.maxSeen) this.maxSeen = max
  }

  private upsert(entry: LinkEntry): void {
    const prev = this.byUrl.get(entry.url)
    if (!prev) {
      this.byUrl.set(entry.url, entry)
      this.sortedDirty = true
      return
    }
    this.byUrl.set(entry.url, { ...entry, count: prev.count + 1 })
    this.sortedDirty = true
  }

  get entries(): readonly LinkEntry[] {
    if (this.sortedDirty) {
      this.sorted = [...this.byUrl.values()].sort(compareEntries)
      this.sortedDirty = false
    }
    return this.sorted
  }

  get produced(): readonly ProducedFile[] {
    if (this.producedDirty) {
      this.producedSorted = [...this.producedByPath.values()].sort(compareProduced)
      this.producedDirty = false
    }
    return this.producedSorted
  }

  get size(): number {
    return this.byUrl.size
  }

  dispose(): void {
    this.unsubscribe?.()
  }
}

/** Shared empty projections (stable identity across no-link states). */
const EMPTY_ENTRIES: readonly LinkEntry[] = []
const EMPTY_PRODUCED: readonly ProducedFile[] = []

/**
 * Plugin-scoped store: one state per session id. The UI observes by session
 * id; switching sessions tears the old state down (spec: clear + rebuild).
 */
export class SessionLinksStore {
  private readonly states = new Map<SessionId, SessionLinksState>()
  private readonly listeners = new Set<() => void>()
  private notifyTimer: ReturnType<typeof setTimeout> | null = null

  /** (Re)attach a session to its snapshot source; a previous state for the same id is torn down first. */
  observe(sessionId: SessionId, source: SnapshotSource | undefined): void {
    const existing = this.states.get(sessionId)
    if (!existing) {
      this.states.set(sessionId, new SessionLinksState(source, () => this.scheduleNotify()))
      this.scheduleNotify()
      return
    }
    // Idempotent: never rebuild an attached state (that would change the
    // entries array identity every effect run and loop React renders).
    // Only a source-less state may be upgraded when a source appears.
    existing.upgradeSource(source)
  }

  /** Detach a session and drop its collected links. */
  release(sessionId: SessionId): void {
    const state = this.states.get(sessionId)
    if (!state) return
    state.dispose()
    this.states.delete(sessionId)
    this.scheduleNotify()
  }

  /** Links of one session, category-group order preserved downstream.
   *  Stable identity per state: returning a fresh array here would break the
   *  useSyncExternalStore snapshot contract and loop React renders. */
  entriesOf(sessionId: SessionId): readonly LinkEntry[] {
    return this.states.get(sessionId)?.entries ?? EMPTY_ENTRIES
  }

  /** Produced files of one session, newest first (stable identity). */
  producedOf(sessionId: SessionId): readonly ProducedFile[] {
    return this.states.get(sessionId)?.produced ?? EMPTY_PRODUCED
  }

  /** Current-session link count (the tab badge value). */
  countOf(sessionId: SessionId): number {
    return this.states.get(sessionId)?.size ?? 0
  }

  /** Apply the host whole-log baseline for one session (no-op when no state or already applied). */
  applyBaseline(sessionId: SessionId, entries: readonly LinkEntry[], produced: readonly ProducedFile[], maxSeq: number): void {
    this.states.get(sessionId)?.applyBaseline(entries, produced, maxSeq)
  }

  /** Subscribe to external changes (React useSyncExternalStore face). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Drop every session state and pending notification. */
  dispose(): void {
    for (const state of this.states.values()) state.dispose()
    this.states.clear()
    this.listeners.clear()
    if (this.notifyTimer !== null) {
      clearTimeout(this.notifyTimer)
      this.notifyTimer = null
    }
  }

  private scheduleNotify(): void {
    if (this.notifyTimer !== null) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      for (const listener of [...this.listeners]) {
        try {
          listener()
        } catch (error) {
          console.error('[dsh-session-links] listener error:', error)
        }
      }
    }, NOTIFY_DEBOUNCE_MS)
  }
}