/**
 * Connection-exclusivity gate run before every `+subscribe` spawn.
 *
 * A Feishu app's long-connection push is cluster mode: a second connection for
 * the same app splits events and both sides lose some silently (spike E3,
 * openspec change pet-locus-doc-comments D3). Before each spawn — first start,
 * explicit reconnect and supervisor restart alike — Pet proves it is about to
 * be the app's only connection by reading `online_instance_cnt`. A non-zero
 * count is waited out briefly, because Pet's own previous child releases in
 * about 3 s and an idle legacy bus retires in about 30 s.
 *
 * The gate owns no process: Pet never runs `event stop`, never touches the
 * shared bus daemon, and never kills anything it did not spawn. Runtime
 * re-checks are deliberately absent (ponytail-2 #4): a conflict that appears
 * while the subscription runs is a disclosed limitation, caught at the next
 * spawn.
 *
 * @module
 */

/** Minimum lark-cli version whose `+subscribe` contract was verified. */
export const SUBSCRIBE_MIN_VERSION = '1.0.97' as const

/** How long a non-zero connection count is waited out. */
export const GATE_WAIT_MS = 40_000
/** Polling interval while waiting. */
export const GATE_POLL_MS = 2_000

/** Result of one connection-count read. */
export type ConnectionCountRead =
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'error'; readonly authFailure: boolean }

/** What the gate needs from the outside world. */
export interface ConnectionGatePort {
  /** `lark-cli --version`, parsed; undefined when unknown. */
  cliVersion(): Promise<string | undefined>
  /** `GET /open-apis/event/v1/connection` as the bot. */
  connectionCount(): Promise<ConnectionCountRead>
  /** Resolves after `ms`, or rejects/returns early when the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>
}

/** Why a gate refused to spawn. */
export type GateRefusal =
  | { readonly reason: 'lark-cli-too-old'; readonly retry: false; readonly diagnostic: string }
  | { readonly reason: 'connection-check-failed'; readonly retry: true; readonly diagnostic: string }
  | { readonly reason: 'event-connection-conflict'; readonly retry: false; readonly diagnostic: string }

/** Gate outcome. `cancelled` means a stop/disable/reconnect won the wait. */
export type GateOutcome =
  | { readonly kind: 'pass' }
  | { readonly kind: 'cancelled' }
  | ({ readonly kind: 'refused' } & GateRefusal)

/** Existing re-login wording, reused so an expired login reads the same everywhere. */
export const RELOGIN_DIAGNOSTIC =
  'lark-cli 未登录 bot 或登录态失效，请重新登录（`lark-cli auth status`），然后重连。'

/** Compare dotted numeric versions; `1.0.100` is newer than `1.0.97`. */
export function versionAtLeast(found: string, minimum: string): boolean {
  const parse = (value: string) => value.split('.').map(part => Number.parseInt(part, 10))
  const have = parse(found)
  const need = parse(minimum)
  for (let index = 0; index < Math.max(have.length, need.length); index += 1) {
    const a = have[index] ?? 0
    const b = need[index] ?? 0
    if (!Number.isFinite(a)) return false
    if (a !== b) return a > b
  }
  return true
}

/**
 * Run the gate once.
 * @param port - Outside-world operations.
 * @param signal - Aborted by stop/disable/reconnect; an aborted gate never passes.
 * @returns whether the caller may spawn.
 */
export async function runConnectionGate(
  port: ConnectionGatePort,
  signal: AbortSignal,
): Promise<GateOutcome> {
  const version = await port.cliVersion()
  if (signal.aborted) return { kind: 'cancelled' }
  if (version === undefined || !versionAtLeast(version, SUBSCRIBE_MIN_VERSION)) {
    return {
      kind: 'refused',
      reason: 'lark-cli-too-old',
      retry: false,
      diagnostic:
        `lark-cli-too-old: found ${version ?? 'unknown'}, need >= ${SUBSCRIBE_MIN_VERSION}. ` +
        'Upgrade lark-cli, then reconnect.',
    }
  }

  let waited = 0
  for (;;) {
    const read = await port.connectionCount()
    if (signal.aborted) return { kind: 'cancelled' }
    if (read.kind === 'error') {
      return {
        kind: 'refused',
        reason: 'connection-check-failed',
        retry: true,
        diagnostic: read.authFailure
          ? `connection-check-failed: ${RELOGIN_DIAGNOSTIC}`
          : 'connection-check-failed: could not read the app\'s event connection count.',
      }
    }
    if (read.count === 0) return { kind: 'pass' }
    if (waited >= GATE_WAIT_MS) {
      return {
        kind: 'refused',
        reason: 'event-connection-conflict',
        retry: false,
        diagnostic:
          `event-connection-conflict: this app already has ${read.count} event connection(s). ` +
          'One app supports one event connection, otherwise events are split. ' +
          'Check `lark-cli event status` (local bus) and `pgrep -fl "event +subscribe"` (local subscribers, ' +
          'including any left by a crashed Host). Pet does not stop other processes. ' +
          'Recommended: give Pet its own Feishu app.',
      }
    }
    try {
      await port.sleep(GATE_POLL_MS, signal)
    } catch {
      return { kind: 'cancelled' }
    }
    if (signal.aborted) return { kind: 'cancelled' }
    waited += GATE_POLL_MS
  }
}
