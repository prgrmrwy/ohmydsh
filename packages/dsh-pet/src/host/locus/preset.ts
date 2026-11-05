/**
 * The preset every locus session (the locus main and, by inheritance on cold
 * resume, its children) composes from.
 *
 * `locus-base` is a neutral whitelist: it names no channel and carries no
 * delegation, workflow or agent-control row. That last property is the point.
 * A child's tool filter restricts the INHERITED plane only, and a delegation
 * row that installs per agent lands in the session's own scope where no filter
 * reaches it, so the only way to keep a child from delegating is for the preset
 * it composes from never to contain such a row.
 *
 * The runtime this package pins loads presets from profile declarations, so the
 * preset is available by id only when the deployment declares it. Mounting
 * therefore checks the catalog first and refuses with a stable code instead of
 * substituting another preset: a locus session on a different preset would run
 * a wider surface than anything Pet reviewed.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Preset id every locus main is created with. */
export const LOCUS_BASE_PRESET = 'locus-base'

/**
 * Preset id every locus child is started with, as an independent selection.
 *
 * DSH 0.2.1 no longer carries a per-request tool filter, so the child's tool
 * ceiling is a property of this preset: `locus-base` with the file-writing
 * tools removed. The selection is persisted with the child
 * (`agent-preset/selected`) and mounted again on every cold resume.
 */
export const LOCUS_CHILD_PRESET = 'locus-child'

/** Stable code carried by {@link LocusPresetMissingError}. */
export const LOCUS_PRESET_MISSING_CODE = 'locus-preset-missing' as const

/** The effective configuration does not offer a locus preset (the main's by default). */
export class LocusPresetMissingError extends Error {
  override readonly name = 'LocusPresetMissingError'
  readonly code = LOCUS_PRESET_MISSING_CODE
  readonly presetId: string

  constructor(detail: string, options?: ErrorOptions & { readonly presetId?: string }) {
    const presetId = options?.presetId ?? LOCUS_BASE_PRESET
    super(`Locus preset ${presetId} is unavailable (${detail})`, options)
    this.presetId = presetId
  }
}

/** The slice of the Host preset registry a locus session needs. */
export interface LocusPresetRegistry {
  list(): PromiseLike<readonly { readonly id: string }[]> | readonly { readonly id: string }[]
  mount(agentContext: Context, presetId: string): Promise<unknown>
}

/**
 * Whether the effective configuration declares a locus preset.
 *
 * An unreadable catalog is "not proven", never "assumed present".
 * @param presets - the Host preset registry.
 * @param presetId - the preset to look for; the main's preset by default.
 * @returns true only when the catalog was read and lists the preset.
 */
export async function isLocusPresetDeclared(
  presets: Pick<LocusPresetRegistry, 'list'>,
  presetId: string = LOCUS_BASE_PRESET,
): Promise<boolean> {
  try {
    const listed = await presets.list()
    return listed.some(preset => preset.id === presetId)
  } catch {
    return false
  }
}

/**
 * Whether BOTH presets a locus needs are declared: the main's and the child's.
 *
 * A locus whose child preset is missing would fail at its first child start
 * (the runtime refuses an unknown independent preset), after a reservation was
 * already made, so creation checks both up front.
 * @param presets - the Host preset registry.
 * @returns true only when both were read and listed.
 */
export async function areLocusPresetsDeclared(presets: Pick<LocusPresetRegistry, 'list'>): Promise<boolean> {
  return (await isLocusPresetDeclared(presets, LOCUS_BASE_PRESET))
    && (await isLocusPresetDeclared(presets, LOCUS_CHILD_PRESET))
}

/**
 * Mount {@link LOCUS_BASE_PRESET} on a locus session being created or resumed.
 * @param presets - the Host preset registry.
 * @param agentContext - the agent context the runtime is composing.
 * @throws LocusPresetMissingError when the preset is not declared; nothing is mounted.
 */
export async function mountLocusPreset(
  presets: LocusPresetRegistry,
  agentContext: Context,
): Promise<void> {
  if (!(await isLocusPresetDeclared(presets))) {
    throw new LocusPresetMissingError('not declared in the effective configuration')
  }
  await presets.mount(agentContext, LOCUS_BASE_PRESET)
}
