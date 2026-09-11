/**
 * Host composition boundary for the unified Feishu locus channel.
 *
 * The channel service deliberately receives a complete capability rather than
 * trying to discover half of the DSH runtime itself. A Host may publish the
 * capability only after composing the strict locus controller and its explicit
 * per-turn observer. When the optional service is absent, callers preserve the
 * existing channel path instead of fabricating an unavailable controller.
 */

import type { LocusAdmissionContext } from '../locus/admission.js'
import {
  LocusChannelController,
  type LocusChannelEvent,
  type LocusControllerDeps,
  type LocusControllerResult,
} from './locus-controller.js'

/** The narrow controller surface consumed by ChannelService/Pipeline. */
export interface LocusChannelControllerPort {
  handle(input: LocusChannelEvent, context?: LocusAdmissionContext): Promise<LocusControllerResult>
  dispose(): void
}

export interface AvailableLocusChannelCapability {
  readonly kind: 'unified-locus'
  readonly status: 'available'
  readonly controller: LocusChannelControllerPort
}

export interface UnavailableLocusChannelCapability {
  readonly kind: 'unified-locus'
  readonly status: 'unavailable'
  /** Stable diagnostic; never includes message text or external identifiers. */
  readonly diagnostic: string
}

/** A complete Host-provided capability; unavailable is diagnostic-only. */
export type LocusChannelCapability =
  | AvailableLocusChannelCapability
  | UnavailableLocusChannelCapability

/** Service key for an optional Host-provided complete locus capability. */
export const LOCUS_CHANNEL_CAPABILITY_SERVICE = 'petLocusChannel'

/** Construct a fail-closed unavailable capability. */
export function unavailableLocusChannelCapability(diagnostic: string): UnavailableLocusChannelCapability {
  const text = diagnostic.trim()
  return {
    kind: 'unified-locus',
    status: 'unavailable',
    diagnostic: text === '' ? 'Unified locus channel is unavailable.' : text,
  }
}

/**
 * Construct the strict controller only from a complete dependency set.
 *
 * `LocusChannelController` refuses in its constructor when the explicit
 * per-turn observer cannot be subscribed.  We convert that result to the
 * unavailable capability so callers cannot accidentally publish accepted
 * Delivery rows without a settlement proof.
 */
export function createLocusChannelCapability(
  deps: LocusControllerDeps,
): LocusChannelCapability {
  let controller: LocusChannelController
  try {
    controller = new LocusChannelController(deps)
  } catch {
    return unavailableLocusChannelCapability('Unified locus channel dependencies could not be composed.')
  }
  if (!controller.available) {
    controller.dispose()
    return unavailableLocusChannelCapability(
      'Unified locus channel requires an explicit per-turn correlation observer.',
    )
  }
  return {
    kind: 'unified-locus',
    status: 'available',
    controller,
  }
}

/** Structural test for a host-adapted controller; no runtime classes are imported by probing. */
function isController(value: unknown): value is LocusChannelControllerPort {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { handle?: unknown; dispose?: unknown }
  return typeof candidate.handle === 'function' && typeof candidate.dispose === 'function'
}

/** Structural validation for a complete capability supplied by a Host composition. */
function isCapability(value: unknown): value is LocusChannelCapability {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as {
    kind?: unknown
    status?: unknown
    controller?: unknown
    diagnostic?: unknown
  }
  if (candidate.kind !== 'unified-locus') return false
  if (candidate.status === 'available') return isController(candidate.controller)
  return candidate.status === 'unavailable' && typeof candidate.diagnostic === 'string' && candidate.diagnostic.trim() !== ''
}

/** Minimal optional context shape used by the production assembly probe. */
export interface LocusCapabilityHostContext {
  get?(name: string): unknown
}

/**
 * Read one complete Host-provided capability, or return undefined. No Pet
 * legacy repository API is touched during this probe. The current Pet Host
 * does not expose this service, so callers must preserve their existing path.
 */
export function probeLocusChannelCapability(
  ctx: LocusCapabilityHostContext,
): LocusChannelCapability | undefined {
  let value: unknown
  try {
    value = ctx.get?.(LOCUS_CHANNEL_CAPABILITY_SERVICE)
  } catch {
    return undefined
  }
  return isCapability(value) ? value : undefined
}
