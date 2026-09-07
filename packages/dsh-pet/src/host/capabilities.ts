/**
 * Pet capability registry.
 *
 * A capability is a Skill name plus computed availability. It carries NO
 * Pet-specific presentation or context declaration: Pet reads only what an
 * ordinary DSH Skill already has (its name and description), so no Skill can
 * adapt itself to Pet and there is no "Pet-aware" class of Skills.
 *
 * Availability is COMPUTED, not declared: an organization-specific adapter
 * that is absent produces a disabled capability with a diagnostic rather than
 * breaking Pet, so the plugin still loads in an open-source environment.
 */

import type { PetRepository } from './repository.js'
import type { PetCapability } from '../wire.js'

/** A capability declaration before availability is computed. */
export interface CapabilityDeclaration {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly skillName: string
  /**
   * Proves the organization-specific dependencies this capability needs.
   * Returning a string disables the capability with that diagnostic.
   */
  readonly probe?: () => string | undefined
}

/**
 * A Host built-in action shown on the wheel.
 *
 * Not a capability and not a Skill: it runs Host code directly, so it has no
 * skill name, no Invocation and no allowlist entry. It exists because some
 * actions cannot be a Skill at all — the QA group must fork a live Agent and
 * write a trusted binding, neither of which a Skill can reach — and hiding
 * that behind a fake Skill would be the "two-tier Skill" the design forbids.
 */
export interface BuiltinActionDeclaration {
  /** Stable action id; MUST NOT collide with a Skill name. */
  readonly id: string
  readonly label: string
  readonly description: string
  /**
   * Whether the action can run right now.
   *
   * Returning a string disables it with that reason. Unlike a Skill probe
   * this is the ONLY availability authority: there is no allowlist entry to
   * fall back on.
   */
  readonly probe: () => string | undefined
}

/** Host-side registry of declared capabilities. */
export class CapabilityRegistry {
  private readonly declarations = new Map<string, CapabilityDeclaration>()
  private readonly builtins = new Map<string, BuiltinActionDeclaration>()

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
   * Declare a Host built-in action.
   * @param action - The action declaration.
   * @returns a disposer removing it.
   */
  registerBuiltin(action: BuiltinActionDeclaration): () => void {
    this.builtins.set(action.id, action)
    return () => {
      this.builtins.delete(action.id)
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
   * Resolve a capability by id from the INSTALLED SKILLS.
   *
   * This is the authoritative lookup: a capability exists because a Skill is
   * installed and enabled, not because Pet ships code for it. An optional
   * Host declaration may annotate the result but can never create one.
   * @param repository - Pet repository supplying the allowlist.
   * @param id - Capability id, which is the Skill name.
   * @returns the resolved capability, or `undefined` when not installed.
   */
  resolve(repository: PetRepository, id: string): PetCapability | undefined {
    return this.project(repository).find(item => item.id === id)
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
    // Capabilities are DERIVED FROM INSTALLED SKILLS, not from Pet-side code.
    // Adding one is an install plus an enable — never a code change — so Pet
    // ships no per-capability adapter.
    //
    // Only ordinary Skill facts are used: the name becomes the label and the
    // description carries the rest. Pet deliberately reads no Pet-specific
    // frontmatter, so an ordinary Skill (say `ws`) is consumed exactly like
    // any other and cannot be given preferential treatment by declaring
    // something extra. Whether the source context suffices is the Skill's own
    // judgement at execution time, not a gate Pet applies here.
    const projected = new Map<string, PetCapability>()

    for (const selection of repository.listSkillSelections()) {
      if (selection.enabled !== true) continue
      const revision = repository.getSkillRevision(selection.skillName)
      if (revision === undefined) continue

      projected.set(selection.skillName, {
        id: selection.skillName,
        label: selection.skillName,
        description: revision.description,
        skillName: selection.skillName,
        kind: 'skill',
        available: true,
        showAsShortcut: selection.showAsShortcut ?? true,
      })
    }

    // Optional Host-side declarations remain supported for capabilities that
    // genuinely need a probe (an organization CLI that may be absent), but
    // they only ANNOTATE a Skill-derived entry — they never create one.
    for (const declaration of this.declarations.values()) {
      const base = projected.get(declaration.skillName)
      if (base === undefined) continue
      const diagnostic = declaration.probe?.()
      projected.set(declaration.skillName, {
        ...base,
        available: diagnostic === undefined,
        ...(diagnostic !== undefined ? { diagnostic } : {}),
      })
    }

    // Built-in actions are the one wheel entry that is NOT a Skill. They are
    // appended, never merged into the map above: sharing the id space with
    // Skill names would let an imported Skill called `qa-group` collide with
    // — or quietly shadow — a Host action.
    const builtins: PetCapability[] = []
    for (const action of this.builtins.values()) {
      const diagnostic = action.probe()
      builtins.push({
        id: action.id,
        label: action.label,
        description: action.description,
        // Kept for wire compatibility; a built-in resolves to no Skill, and
        // nothing may look one up from this value.
        skillName: '',
        kind: 'builtin',
        available: diagnostic === undefined,
        ...(diagnostic !== undefined ? { diagnostic } : {}),
        showAsShortcut: true,
      })
    }

    return [
      ...[...projected.values()].sort((left, right) => left.id.localeCompare(right.id)),
      ...builtins.sort((left, right) => left.id.localeCompare(right.id)),
    ]
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
  ): { skillName: string; sourcePath: string } {
    // The capability id IS the Skill name: a capability exists because a Skill
    // is installed and enabled, not because Pet ships a declaration for it.
    const selection = repository.getSkillSelection(capabilityId)
    if (selection?.enabled !== true) {
      throw new Error(`Pet Skill '${capabilityId}' is not enabled`)
    }
    const revision = repository.getSkillRevision(capabilityId)
    if (revision === undefined) {
      throw new Error(`Pet Skill '${capabilityId}' is no longer registered`)
    }
    return { skillName: capabilityId, sourcePath: revision.sourcePath }
  }
}
