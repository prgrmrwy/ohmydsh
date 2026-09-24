/**
 * Shared wire contract for dsh-session-links.
 *
 * One Connection RPC channel carries a single read-only endpoint that
 * extracts every link from a session's **complete** event log on the host
 * (whole-log baseline — immune to chat-window truncation and compaction),
 * summarized as the same {@link LinkEntry} shape the client collector
 * maintains incrementally from the live conversation snapshot.
 *
 * @module dsh-session-links/contract
 */
import type { LinkEntry } from './shared/links.js'
import type { ProducedFile } from './shared/produced.js'

/** The Connection RPC channel this package registers on the host. */
export const SESSION_LINKS_CHANNEL = '/dsh-session-links'
/** The read-only baseline endpoint answered by the host. */
export const SESSION_LINKS_ENTRIES_ENDPOINT = 'links'

/** Baseline request: which session's complete log to scan. */
export interface SessionLinksRequest {
  /** The session id whose log is read (scope-addressed ids allowed too). */
  sessionId: string
}

/** Baseline answer: deduped entries plus the watermark the client resumes from. */
export interface SessionLinksBaseline {
  /** Full-session link set, deduped (one entry per URL, latest occurrence). */
  entries: LinkEntry[]
  /** Full-session produced files (first-seen per path; window-truncation proof). */
  produced: ProducedFile[]
  /** Highest event seq parsed from the log (the client's incremental watermark). */
  maxSeq: number
  /** Always true: the host reads the whole durable log, not a window. */
  complete: true
}