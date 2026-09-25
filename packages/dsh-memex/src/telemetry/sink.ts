import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RecallRecord } from './record.js'

/** Owner-only, matching the convention other plugins use for their state roots. */
const OWNER_ONLY_DIR_MODE = 0o700

/**
 * Telemetry lives outside every library.
 *
 * `dsh-memex-memory` forbids private storage or private indexes inside a
 * library and requires each one to stay usable on its own through the kernel
 * CLI and Obsidian. A log written into `cards/` would breach both, and would
 * also ride along with card sync since libraries are git repositories.
 */
export function telemetryDir(env: NodeJS.ProcessEnv = process.env): string {
  const dshHome = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(dshHome, 'plugins', 'dsh-memex')
}

/** One file per month keeps any single file small without needing rotation. */
export function telemetryFile(at: Date, env: NodeJS.ProcessEnv = process.env): string {
  const month = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
  return join(telemetryDir(env), `recall-${month}.ndjson`)
}

export interface SinkOptions {
  readonly env?: NodeJS.ProcessEnv
  /** Called at most once, the first time a write fails. */
  readonly onFirstFailure?: (message: string) => void
}

/** Set once a failure has been reported, so a broken sink cannot spam the log. */
let reportedFailure = false

/** Reset the once-only failure latch. Tests only. */
export function resetFailureLatch(): void {
  reportedFailure = false
}

/**
 * Append one record, best effort.
 *
 * Every failure is swallowed. Telemetry serves measurement, not function:
 * letting a bookkeeping failure break a search would turn an observability
 * aid into a new source of outages, which costs more than the visibility is
 * worth. Search results are byte-identical whether or not this succeeds.
 *
 * NDJSON is append-only by line, so a crash can only corrupt the final line and
 * readers skip unparseable ones. No locking and no read-modify-write.
 */
export function appendRecord(record: RecallRecord, options: SinkOptions = {}): void {
  const env = options.env ?? process.env
  try {
    const dir = telemetryDir(env)
    mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
    appendFileSync(telemetryFile(new Date(record.at), env), `${JSON.stringify(record)}\n`, 'utf8')
  } catch (error) {
    if (reportedFailure) return
    reportedFailure = true
    options.onFirstFailure?.(
      `Recall telemetry unavailable, continuing without it: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
