/**
 * Pet capability registry.
 *
 * A capability is UI metadata plus a Skill name and a context requirement.
 * Availability is COMPUTED, not declared: an organization-specific adapter
 * that is absent produces a disabled capability with a diagnostic rather than
 * breaking Pet, so the plugin still loads in an open-source environment.
 */

import type { PetRepository } from './repository.js'
import type { PetCapability, PetContextRequirement } from '../wire.js'

/** A capability declaration before availability is computed. */
export interface CapabilityDeclaration {
  readonly id: string
  readonly label: string
  readonly icon?: string
  readonly description: string
  readonly skillName: string
  readonly contextRequirement: PetContextRequirement
  readonly requiresConfirmation?: boolean
  /**
   * Proves the organization-specific dependencies this capability needs.
   * Returning a string disables the capability with that diagnostic.
   */
  readonly probe?: () => string | undefined
}

/** Host-side registry of declared capabilities. */
export class CapabilityRegistry {
  private readonly declarations = new Map<string, CapabilityDeclaration>()

  /**
   * Declare a capability.
   * @param declaration - The capability declaration.
   * @returns a disposer removing it.
   */
  register(declaration: CapabilityDeclaration): () => void {
    this.declarations.set(declaration.id, declaration)
    return () => {
      this.declarations.delete(declaration.id)
    }
  }

  /**
   * Look up one declaration.
   * @param id - Capability id.
   * @returns the declaration, or `undefined`.
   */
  get(id: string): CapabilityDeclaration | undefined {
    return this.declarations.get(id)
  }

  /**
   * Project every capability read-only for the Web client.
   *
   * A capability is available only when its dependencies probe clean AND its
   * Skill is currently enabled in the Pet allowlist, so the radial menu can
   * never offer work the executor would refuse.
   * @param repository - Pet repository supplying the allowlist.
   * @returns the read-only projection, ordered by id.
   */
  project(repository: PetRepository): readonly PetCapability[] {
    return [...this.declarations.values()]
      .map(declaration => {
        const probeDiagnostic = declaration.probe?.()
        const selection = repository.getSkillSelection(declaration.skillName)
        const skillDiagnostic =
          selection === undefined || selection.enabledDigest === undefined
            ? `Skill '${declaration.skillName}' is not installed or not enabled in Pet Settings → Skills.`
            : undefined
        const diagnostic = probeDiagnostic ?? skillDiagnostic
        return {
          id: declaration.id,
          label: declaration.label,
          ...(declaration.icon !== undefined ? { icon: declaration.icon } : {}),
          description: declaration.description,
          skillName: declaration.skillName,
          contextRequirement: declaration.contextRequirement,
          requiresConfirmation: declaration.requiresConfirmation ?? false,
          available: diagnostic === undefined,
          ...(diagnostic !== undefined ? { diagnostic } : {}),
          // Default true: a capability whose Skill was never selected is not
          // hidden, it is simply unavailable and shows its diagnostic.
          showAsShortcut: selection?.showAsShortcut ?? true,
        } satisfies PetCapability
      })
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  /**
   * Resolve the enabled digest a new Invocation must be fixed to.
   * @param repository - Pet repository.
   * @param capabilityId - Capability id.
   * @returns the skill name and digest to fix.
   * @throws when the capability is unknown or its Skill is not enabled.
   */
  resolveSkill(
    repository: PetRepository,
    capabilityId: string,
  ): { skillName: string; digest: string } {
    const declaration = this.declarations.get(capabilityId)
    if (declaration === undefined) {
      throw new Error(`Unknown Pet capability '${capabilityId}'`)
    }
    const selection = repository.getSkillSelection(declaration.skillName)
    if (selection?.enabledDigest === undefined) {
      throw new Error(`Pet Skill '${declaration.skillName}' is not enabled`)
    }
    return { skillName: declaration.skillName, digest: selection.enabledDigest }
  }
}
