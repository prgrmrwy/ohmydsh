/**
 * `memex sync --status` output contract.
 *
 * The kernel has no structured output for sync state, so this module owns the
 * only place that reads its human-facing text. The parsing is bound to the
 * pinned kernel version (see `tools/descriptions.generated.ts`): a kernel
 * upgrade must re-run these cases before the settings page is trusted.
 *
 * Observed against @touchskyer/memex 0.4.1:
 *
 * ```
 * remote: git@github.com:user/repo.git      // configured
 * adapter: git
 * auto: on
 * last sync: 2026-09-19T18:07:37.638Z
 *
 * Sync not configured. Run `memex sync --init`.   // unconfigured, exit 0
 * ```
 *
 * Unconfigured and missing libraries are indistinguishable here, and neither
 * creates anything — callers must check the library directory separately.
 *
 * @module dsh-memex/run/sync-status
 */
import { KernelError } from './types.js'

/** One library's sync state, as the kernel reports it. */
export interface SyncStatus {
  /** False when no remote is configured (the kernel prints its "not configured" line). */
  readonly configured: boolean
  readonly remote?: string
  readonly adapter?: string
  /** Auto-sync after every write; absent when the kernel reported an unknown value. */
  readonly auto?: boolean
  readonly lastSync?: string
}

const NOT_CONFIGURED = 'Sync not configured'

/**
 * Parse one `memex sync --status` result.
 * @param stdout - the kernel's stdout.
 * @returns the parsed sync state.
 * @throws KernelError when the output matches no known shape (never guess).
 */
export function parseSyncStatus(stdout: string): SyncStatus {
  const text = stdout.trim()
  if (text === '') throw new KernelError('unparseable', 'Empty memex sync status output')
  if (text.includes(NOT_CONFIGURED)) return { configured: false }

  const fields = new Map<string, string>()
  for (const line of text.split('\n')) {
    const match = line.match(/^([a-z][a-z ]*):\s*(.*)$/i)
    if (match?.[1] !== undefined && match[2] !== undefined) fields.set(match[1].trim().toLowerCase(), match[2].trim())
  }
  const remote = fields.get('remote')
  if (remote === undefined || remote === '') {
    throw new KernelError('unparseable', 'Unrecognized memex sync status output')
  }
  const adapter = fields.get('adapter')
  const auto = fields.get('auto')
  const lastSync = fields.get('last sync')
  return {
    configured: true,
    remote,
    ...(adapter !== undefined && adapter !== '' ? { adapter } : {}),
    ...(auto === 'on' || auto === 'off' ? { auto: auto === 'on' } : {}),
    ...(lastSync !== undefined && lastSync !== '' ? { lastSync } : {}),
  }
}
