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

/** Preset id every locus main is created with and every locus child recovers from. */
export const LOCUS_BASE_PRESET = 'locus-base'

/** Stable code carried by {@link LocusPresetMissingError}. */
export const LOCUS_PRESET_MISSING_CODE = 'locus-preset-missing' as const

/** The effective configuration does not offer {@link LOCUS_BASE_PRESET}. */
export class LocusPresetMissingError extends Error {
  override readonly name = 'LocusPresetMissingError'
  readonly code = LOCUS_PRESET_MISSING_CODE
  readonly presetId: string

  constructor(detail: string, options?: ErrorOptions) {
    super(`Locus preset ${LOCUS_BASE_PRESET} is unavailable (${detail})`, options)
    this.presetId = LOCUS_BASE_PRESET
  }
}

/** The slice of the Host preset registry a locus session needs. */
export interface LocusPresetRegistry {
  list(): PromiseLike<readonly { readonly id: string }[]> | readonly { readonly id: string }[]
  mount(agentContext: Context, presetId: string): Promise<unknown>
}

/**
 * Whether the effective configuration declares {@link LOCUS_BASE_PRESET}.
 *
 * An unreadable catalog is "not proven", never "assumed present".
 * @param presets - the Host preset registry.
 * @returns true only when the catalog was read and lists the preset.
 */
export async function isLocusPresetDeclared(presets: Pick<LocusPresetRegistry, 'list'>): Promise<boolean> {
  try {
    const listed = await presets.list()
    return listed.some(preset => preset.id === LOCUS_BASE_PRESET)
  } catch {
    return false
  }
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
