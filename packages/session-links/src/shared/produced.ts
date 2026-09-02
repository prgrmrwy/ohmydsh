/**
 * Shared produced-file model: the mutation-tool locations semantics of the
 * official deliverables vocabulary, usable by both halves.
 */
import type { LinkEntry } from './links.js'

/** One produced file seen in the session (first-seen order per file). */
export interface ProducedFile {
  /** The model-facing path the tool operated on. */
  path: string
  /** Unix epoch ms of the event that first produced the file. */
  time: number
  /** Seq of the event that first produced the file. */
  seq: number
}

/** Display ordering for produced files: newest first (first-seen identity kept). */
export function compareProduced(a: ProducedFile, b: ProducedFile): number {
  if (a.time !== b.time) return b.time - a.time
  return b.seq - a.seq
}

/** The bridge a host baseline passes to the event fold for render-intent views. */
export type PresentCall = (name: string, argsRaw: string) => {
  card: string
  kind?: string
  locations?: readonly { path: string; line?: number }[]
  diffs?: readonly { path: string }[]
} | undefined

/** An event fold result: links, produced files, and the highest seq seen. */
export interface SessionExtraction {
  entries: LinkEntry[]
  produced: ProducedFile[]
  maxSeq: number
}