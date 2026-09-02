/**
 * The session-links panel: groups the current session's collected links by
 * category, newest first (assistant-sourced ties win), opens links in a new
 * tab, and shows an empty state when there is nothing to show.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  SESSION_LINKS_CHANNEL,
  SESSION_LINKS_ENTRIES_ENDPOINT,
  type SessionLinksBaseline,
} from '../contract.js'
import { CATEGORY_LABELS, CATEGORY_ORDER, compareEntries, type LinkEntry } from '../shared/links.js'
import type { ProducedFile } from './produces.js'
import type { SessionLinksStore } from './collector.js'

/** Relative-time label for a message timestamp. */
export function formatLinkTime(time: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - time)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}


/** Call `/dsh-session-links` `links` and unwrap the baseline (throws on failure). */
export async function fetchSessionLinks(
  rpc: ClientConnectionRpc,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionLinksBaseline> {
  const result = (await rpc.call(SESSION_LINKS_CHANNEL, SESSION_LINKS_ENTRIES_ENDPOINT, { sessionId }, signal)) as
    | { ok: true; value: SessionLinksBaseline }
    | { ok: false; error?: { message?: string } }
  if (!result.ok) {
    throw new Error(result.error?.message ?? 'unknown session-links error')
  }
  return result.value
}

export interface PanelProps {
  ctx: ClientContext
  store: SessionLinksStore
  sessionId: SessionId | undefined
  /** Open a produced file in the workbench (better-sidebar editor host); undefined = plain text. */
  onOpenFile?: ((path: string) => void) | undefined
}

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 13,
  lineHeight: 1.45,
  color: 'var(--dsw-alias-label-primary)',
}
const LINK_STYLE: CSSProperties = {
  color: 'var(--dsw-alias-accent, #4e8cff)',
  textDecoration: 'none',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
}
const META_STYLE: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  whiteSpace: 'nowrap',
  flexShrink: 0,
}

/** The panel body; attached/detached to the session snapshot via effects.
 *  Deliberately NOT useSyncExternalStore: plain subscribe + setState keeps
 *  rendering driven by explicit change notifications only, so a snapshot
 *  reference wrinkle can never turn into a max-update-depth loop. */
export function Panel({ ctx, store, sessionId, onOpenFile }: PanelProps) {
  const [entries, setEntries] = useState<readonly LinkEntry[]>(EMPTY)
  const [produced, setProduced] = useState<readonly ProducedFile[]>(EMPTY_PRODUCED)
  const openFile = onOpenFile ?? (() => {})

  useEffect(() => {
    if (!sessionId) return
    void ctx // ctx is stable by plugin design; kept out of deps to avoid effect churn
    const binding = ctx.sessions?.binding(sessionId)
    store.observe(sessionId, binding?.session)
    const sync = (): void => {
      setEntries(store.entriesOf(sessionId))
      setProduced(store.producedOf(sessionId))
    }
    sync() // initial value (observe may already have ingested)
    const unsubscribe = store.subscribe(sync)

    // Whole-log baseline from the host (window-truncation and compaction
    // proof). Failure degrades silently to the live-window semantics.
    const rpc = (ctx.get as unknown as (key: string) => { rpc?: ClientConnectionRpc } | undefined)?.('connection')?.rpc
    const controller = new AbortController()
    const attemptBaseline = (attempt: number): void => {
      if (!rpc) {
        if (attempt === 0) console.warn('[dsh-session-links] baseline NOT fetched: connection RPC unavailable on tab context')
        return
      }
      fetchSessionLinks(rpc, sessionId, controller.signal)
        .then((baseline) => {
          console.info(`[dsh-session-links] baseline applied: ${baseline.entries.length} entries, maxSeq ${baseline.maxSeq}, complete ${baseline.complete}`)
          store.applyBaseline(sessionId, baseline.entries, baseline.produced, baseline.maxSeq)
        })
        .catch((error) => {
          // Connection may still be re-establishing right after a DSH restart:
          // retry with a short backoff before falling back to window semantics.
          if (attempt < 2 && !controller.signal.aborted) {
            setTimeout(() => attemptBaseline(attempt + 1), 1_000 * (attempt + 1))
          } else {
            console.warn('[dsh-session-links] baseline fetch failed:', error instanceof Error ? error.message : String(error))
          }
        })
    }
    attemptBaseline(0)
    return () => {
      controller.abort()
      unsubscribe()
      store.release(sessionId)
    }
  }, [store, sessionId])

  if (!sessionId || (entries.length === 0 && produced.length === 0)) {
    return (
      <div style={{ padding: '16px 12px', fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>
        当前会话暂无文档/资料 —— MR、部署、Meego、制品链接与本次产出的文件会在这里展示。
      </div>
    )
  }

  const now = Date.now()

  return (
    <div>
      {produced.length > 0 && (
        <section>
          <h4
            style={{
              margin: 0,
              padding: '10px 10px 4px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--dsw-alias-label-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            本次产出 · {produced.length}
          </h4>
          {produced.map((file) => (
            <div key={file.path} style={ROW_STYLE} title={file.path}>
              <button
                type="button"
                onClick={() => openFile(file.path)}
                style={{ ...LINK_STYLE, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--dsh-font-mono, monospace)', textAlign: 'left' }}
              >
                # {file.path.split(/[\\/]/).pop()}
              </button>
              <span style={META_STYLE}>{formatLinkTime(file.time, now)}</span>
            </div>
          ))}
        </section>
      )}
      {CATEGORY_ORDER.map((category) => {
        const items = entries.filter((entry) => entry.category === category).sort(compareEntries)
        if (items.length === 0) return null
        return (
          <section key={category}>
            <h4
              style={{
                margin: 0,
                padding: '10px 10px 4px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--dsw-alias-label-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {CATEGORY_LABELS[category]} · {items.length}
            </h4>
            {items.map((entry) => (
              <LinkRow key={entry.url} entry={entry} now={now} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

const EMPTY: readonly LinkEntry[] = []
const EMPTY_PRODUCED: readonly ProducedFile[] = []

/** One link row: opens in a new tab, never injects script into the target. */
function LinkRow({ entry, now }: { entry: LinkEntry; now: number }) {
  return (
    <div style={ROW_STYLE} title={entry.url}>
      <a href={entry.url} target="_blank" rel="noreferrer" style={LINK_STYLE}>
        {entry.title}
      </a>
      <span style={META_STYLE}>
        {formatLinkTime(entry.time, now)}
        {entry.count > 1 ? ` ×${entry.count}` : ''}
      </span>
    </div>
  )
}