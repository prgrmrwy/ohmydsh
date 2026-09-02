/**
 * The Pet allowlist Skill provider — Pet's real authorization boundary.
 *
 * Workspace symlink projection only makes enabled revisions *discoverable*;
 * it does not decide what a Pet Agent may run. This provider serves exactly
 * the persisted allowlist, resolved from the immutable store by digest, so a
 * globally visible Skill of the same name can never expand Pet's capabilities.
 *
 * Resolution is by DIGEST, not by name: an Invocation fixes its revision at
 * acceptance time, so enabling or upgrading a Skill mid-queue cannot change
 * what already-queued work executes.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition } from '@deepseek-ai/dsh-skill'
import { PetError } from './errors.js'
import type { PetPaths } from './paths.js'
import type { PetRepository } from './repository.js'
import { SKILL_ENTRY_FILE, parseFrontmatter, verifyRevision } from './skill-bundle.js'

/** Provider name registered in `ctx.skills`. */
export const PET_SKILL_PROVIDER = 'dsh-pet-allowlist'

/** One allowlist entry: a name bound to an exact immutable revision. */
export interface AllowlistEntry {
  readonly skillName: string
  readonly digest: string
  readonly description: string
}

/** Opaque locator handed back to `get()`, carrying the fixed revision. */
interface PetSkillLocator {
  readonly skillName: string
  readonly digest: string
}

/**
 * Compute the current allowlist from persisted selections.
 *
 * Only skills with an enabled digest whose revision row still exists are
 * eligible; a selection referencing a removed revision is omitted rather than
 * falling back to another version.
 * @param repository - Pet repository.
 * @returns the current allowlist.
 */
export function currentAllowlist(repository: PetRepository): readonly AllowlistEntry[] {
  const entries: AllowlistEntry[] = []
  for (const selection of repository.listSkillSelections()) {
    if (selection.enabledDigest === undefined) continue
    const revision = repository.getSkillRevision(selection.skillName, selection.enabledDigest)
    if (revision === undefined) continue
    entries.push({
      skillName: selection.skillName,
      digest: selection.enabledDigest,
      description: revision.description,
    })
  }
  return entries.sort((left, right) => left.skillName.localeCompare(right.skillName))
}

/**
 * Load one skill body directly from an immutable store revision.
 *
 * Reads through the store path rather than the Workspace projection so a
 * tampered or drifted projection cannot influence what the Agent receives.
 * @param paths - Resolved Pet paths.
 * @param skillName - Skill name.
 * @param digest - Fixed revision digest.
 * @returns the loaded definition.
 * @throws PetError when the revision is missing or fails digest verification.
 */
export async function loadRevision(
  paths: PetPaths,
  skillName: string,
  digest: string,
): Promise<SkillDefinition> {
  if (!(await verifyRevision(paths.storeRoot, skillName, digest))) {
    throw new PetError(
      'SKILL_DIGEST_MISMATCH',
      `Pet Skill ${skillName}@${digest} is missing or no longer matches its digest`,
    )
  }
  const revisionRoot = path.join(paths.storeRoot, skillName, digest)
  const raw = await readFile(path.join(revisionRoot, SKILL_ENTRY_FILE), 'utf8')
  const frontmatter = parseFrontmatter(raw)
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  return {
    name: skillName,
    description: frontmatter.description ?? '',
    ...(frontmatter.whenToUse !== undefined ? { whenToUse: frontmatter.whenToUse } : {}),
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider: PET_SKILL_PROVIDER,
    resourceBase: { kind: 'directory', path: revisionRoot },
    content: body,
    path: path.join(revisionRoot, SKILL_ENTRY_FILE),
  }
}

/**
 * Build the scoped Pet Skill provider.
 *
 * The provider is registered ONLY in the Pet executor composition; the broad
 * `tool-skill` filesystem catalog is omitted or shadowed there, so global,
 * user and project providers cannot contribute skills to a Pet Agent.
 * @param repository - Pet repository supplying the persisted allowlist.
 * @param paths - Resolved Pet paths.
 * @returns the provider registration object.
 */
export function createPetSkillProvider(
  repository: PetRepository,
  paths: PetPaths,
): {
  name: string
  list: () => Promise<readonly SkillCandidate[]>
  get: (candidate: SkillCandidate) => Promise<SkillDefinition | undefined>
} {
  return {
    name: PET_SKILL_PROVIDER,
    list: async (): Promise<readonly SkillCandidate[]> =>
      currentAllowlist(repository).map(entry => ({
        name: entry.skillName,
        description: entry.description,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'custom',
        provider: PET_SKILL_PROVIDER,
        rank: BUNDLED_SKILL_RANK,
        locator: { skillName: entry.skillName, digest: entry.digest } satisfies PetSkillLocator,
        path: path.join(paths.storeRoot, entry.skillName, entry.digest, SKILL_ENTRY_FILE),
        resourceBase: {
          kind: 'directory',
          path: path.join(paths.storeRoot, entry.skillName, entry.digest),
        },
      })),
    get: async (candidate: SkillCandidate): Promise<SkillDefinition | undefined> => {
      const locator = candidate.locator as PetSkillLocator | undefined
      if (locator === undefined) return undefined
      return loadRevision(paths, locator.skillName, locator.digest).catch(() => undefined)
    },
  }
}

/**
 * Resolve the Skill an Invocation is allowed to run.
 *
 * This is the explicit `/<name>` injection boundary. It fails closed for an
 * unknown, disabled or revision-mismatched name instead of degrading the
 * leading token into ordinary prose.
 * @param repository - Pet repository.
 * @param paths - Resolved Pet paths.
 * @param skillName - Requested skill name.
 * @param fixedDigest - Digest fixed on the Invocation.
 * @returns the loaded definition.
 * @throws PetError when the request is not permitted.
 */
export async function resolveInvocationSkill(
  repository: PetRepository,
  paths: PetPaths,
  skillName: string,
  fixedDigest: string,
): Promise<SkillDefinition> {
  const revision = repository.getSkillRevision(skillName, fixedDigest)
  if (revision === undefined) {
    throw new PetError(
      'SKILL_NOT_FOUND',
      `Pet Skill ${skillName}@${fixedDigest} is not installed`,
    )
  }
  const selection = repository.getSkillSelection(skillName)
  if (selection === undefined || selection.enabledDigest === undefined) {
    throw new PetError('SKILL_DISABLED', `Pet Skill ${skillName} is not enabled`)
  }
  // Deliberately NOT requiring `selection.enabledDigest === fixedDigest`: a
  // queued Invocation keeps running its fixed revision after an upgrade. The
  // revision row's continued existence is what authorizes it.
  return loadRevision(paths, skillName, fixedDigest)
}

/**
 * Digests that may be physically garbage collected.
 *
 * Retains every digest referenced by an unarchived Task or non-terminal
 * Invocation, plus every currently enabled selection.
 * @param repository - Pet repository.
 * @returns collectable `{ skillName, digest }` pairs.
 */
export function collectableRevisions(
  repository: PetRepository,
): readonly { skillName: string; digest: string }[] {
  const retained = repository.referencedDigests()
  return repository
    .listSkillRevisions()
    .filter(revision => !retained.has(`${revision.skillName}@${revision.digest}`))
    .map(revision => ({ skillName: revision.skillName, digest: revision.digest }))
}
