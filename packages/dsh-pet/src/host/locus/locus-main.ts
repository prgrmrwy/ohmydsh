/**
 * The locus main session's locked-down surface, as a checkable fact.
 *
 * A locus main exists to coordinate: it holds the collaboration space, receives
 * what its children ask, and answers them. It must never be able to change
 * anything on the owner's machine or hand work to a descendant, because it is a
 * long-lived session that nobody watches turn by turn. Four things make that
 * true and each is read back, never assumed:
 *
 * - the preset it composes from is the neutral whitelist (checked elsewhere);
 * - a deny-style tool restriction removes `bash`, `write`, `edit` and every
 *   delegation route, and leaves the Host-level `collab_*` tools alone;
 * - its approval policy is `never`, so nothing can ever be approved for it;
 * - its sandbox mode is `read-only`.
 *
 * This module carries no Cordis or DSH import: it only decides, from facts the
 * caller read, whether the surface is the reviewed one.
 */

import { LOCUS_MAIN_PRESET } from './aggregate.js'
import { LOCUS_DELEGATION_DENYLIST } from './composition.js'

/**
 * Tools the official Agent Team plugin registers into every ordinary root's OWN
 * scope (a locus main is one). `tools.restrict` cannot hide scoped
 * registrations, so for these the execution guard is the enforcement.
 */
export const LOCUS_TEAM_TOOLS: readonly string[] = Object.freeze([
  'spawn_teammate',
  'send_message',
  'list_agents',
  'interrupt_agent',
  'wait_agent',
  'team_task_create',
  'team_task_get',
  'team_task_list',
  'team_task_update',
])

/** Tools a locus main may never call, whatever the preset or plugins offer. */
export const LOCUS_MAIN_DENIED_TOOLS: readonly string[] = Object.freeze([...new Set([
  'bash',
  'write',
  'edit',
  ...LOCUS_DELEGATION_DENYLIST,
  ...LOCUS_TEAM_TOOLS,
])])

/** What the Host reads back about a freshly built locus main. */
export interface LocusMainObservedSurface {
  /** Names of every tool visible to the live agent. */
  readonly toolNames: readonly string[]
  /** The effective approval policy, when it could be read. */
  readonly approval: string | undefined
  /** The effective sandbox mode, when it could be read. */
  readonly sandbox: string | undefined
  /** Denied names a Host execution guard on this exact agent refuses. */
  readonly guarded?: readonly string[]
}

export type LocusMainAttestation =
  | { readonly ok: true }
  | { readonly ok: false; readonly leaks: readonly string[] }

/**
 * Decide whether an observed surface is the locked-down locus main.
 *
 * Anything that could not be read counts against the session: a setting nobody
 * could confirm is a setting nobody can claim.
 * @param observed - what was read back from the live session.
 * @returns ok, or the list of reasons it is not.
 */
export function attestLocusMainSurface(observed: LocusMainObservedSurface): LocusMainAttestation {
  const leaks: string[] = []
  for (const name of observed.toolNames) {
    // Visible-but-guarded is accepted only because scoped registrations
    // cannot be hidden; an unguarded denied tool is a real leak.
    if (LOCUS_MAIN_DENIED_TOOLS.includes(name) && !observed.guarded?.includes(name)) leaks.push(`tool:${name}`)
  }
  if (!observed.toolNames.some(name => name.startsWith('collab_'))) leaks.push('missing:collab_*')
  if (observed.approval !== 'never') leaks.push(`approval:${observed.approval ?? 'unreadable'}`)
  if (observed.sandbox !== 'read-only') leaks.push(`sandbox:${observed.sandbox ?? 'unreadable'}`)
  return leaks.length === 0 ? { ok: true } : { ok: false, leaks }
}

/** One session-log event, as far as the settings fold needs it. */
export interface LocusMainSettingEvent {
  readonly type: string
  readonly data?: unknown
}

/**
 * Fold the durable settings out of a cold-read session log.
 *
 * The log is the only store of both settings (`approval/policy` and
 * `sandbox/mode` are log-only events whose last occurrence is the override), so
 * reading it back is reading the effective value, not a copy of what was asked.
 * @param events - the session's events, oldest first.
 * @returns the last approval policy and sandbox mode recorded, if any.
 */
export function foldLocusMainSettings(
  events: readonly LocusMainSettingEvent[],
): { readonly approval: string | undefined; readonly sandbox: string | undefined } {
  let approval: string | undefined
  let sandbox: string | undefined
  for (const event of events) {
    const data = event.data as { policy?: unknown; mode?: unknown } | undefined
    if (event.type === 'approval/policy' && typeof data?.policy === 'string') approval = data.policy
    if (event.type === 'sandbox/mode' && typeof data?.mode === 'string') sandbox = data.mode
  }
  return { approval, sandbox }
}

/** The session facts needed to judge a locus main; a subset of what the Host resolves. */
export interface LocusMainSessionFacts {
  readonly id: string
  readonly state?: 'active' | 'archived' | 'missing'
  readonly parentSessionId?: string
  readonly agentPreset?: string
}

/**
 * Whether a resolved session is a locus main that can still serve.
 *
 * It must resolve, not be archived or gone, be a top-level session, and still
 * run the neutral locus preset. A preset that is not provably the reviewed one
 * is a locus main that is not proven locked down, and "not proven" is not
 * usable. One definition, used by the controller (which repairs) and by the
 * resolver (which refuses to serve), so the two cannot disagree.
 * @param session - what the Host resolved for the locus main id, or undefined.
 * @param expectedId - the id that was asked for.
 */
export function isUsableLocusMainSession(
  session: LocusMainSessionFacts | undefined,
  expectedId: string,
): boolean {
  return session !== undefined &&
    session.id === expectedId &&
    session.state !== 'archived' &&
    session.state !== 'missing' &&
    session.parentSessionId === undefined &&
    session.agentPreset === LOCUS_MAIN_PRESET
}
