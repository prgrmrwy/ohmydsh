/**
 * Concrete Pet management routes.
 *
 * Each route has an exact path and a strict body allowlist. Together they
 * cover exactly the operations the Web client needs and nothing more.
 */

import { archiveTaskFromPet, type ArchiveSink } from './archive.js'
import type { CapabilityRegistry } from './capabilities.js'
import type { PetCoordinator } from './coordinator.js'
import { PetError } from './errors.js'
import {
  optionalString,
  petRoute,
  requireString,
  strictBody,
  type RouteRegistration,
} from './http.js'
import type { PetChangeFeed } from './changes.js'
import type { PetLifecycleMachine } from './lifecycle.js'
import type { PetPaths } from './paths.js'
import { detectProjectionDrift, rebuildProjection } from './projection.js'
import type { PetRepository } from './repository.js'
import { inspectBundle, installBundle, removeRevisionDirectory } from './skill-bundle.js'
import { collectableRevisions, currentAllowlist } from './skill-provider.js'
import { ROUTES, type PetSourceKind } from '../wire.js'

/** Everything the routes read from the Host. */
export interface RouteDeps {
  readonly repository: PetRepository
  readonly capabilities: CapabilityRegistry
  readonly coordinator: PetCoordinator
  readonly lifecycle: PetLifecycleMachine
  readonly paths: PetPaths
  readonly packageVersion: string
  readonly changes: PetChangeFeed
  /** Archives the executor session when a terminal Task is archived from Pet. */
  readonly archiveSink: ArchiveSink
  /**
   * The model Pet currently follows, for display only. Returns `undefined`
   * when it cannot be resolved, so the panel degrades instead of failing.
   */
  readonly followedModel?: () => { providerId: string; modelId: string } | undefined
}

/** Desired projection derived from the current allowlist. */
function desiredProjection(
  repository: PetRepository,
): readonly { skillName: string; digest: string }[] {
  return currentAllowlist(repository).map(entry => ({
    skillName: entry.skillName,
    digest: entry.digest,
  }))
}

/** Assert Pet is ready before accepting work. */
function requireReady(lifecycle: PetLifecycleMachine): void {
  if (!lifecycle.isReady) {
    throw new PetError(
      'PET_DEGRADED',
      lifecycle.state.diagnostic ?? 'Pet is not ready. See Pet Settings → Diagnostics.',
    )
  }
}

/**
 * Build every Pet management route.
 * @param deps - Host dependencies.
 * @returns the exact route registrations.
 */
export function createPetRoutes(deps: RouteDeps): readonly RouteRegistration[] {
  const { repository, capabilities, coordinator, lifecycle, paths } = deps

  return [
    petRoute(ROUTES.status, async ({ body }) => {
      const record = strictBody(body, ['seenGeneration'])
      const seen = record['seenGeneration']
      return {
        lifecycle: lifecycle.state,
        version: deps.packageVersion,
        skillSetGeneration: repository.global.skillSetGeneration,
        // Generation-aware refresh: the client compares this instead of
        // polling, and reloads a complete snapshot when it is stale.
        generation: deps.changes.generation,
        stale: typeof seen === 'number' ? deps.changes.isStale(seen) : true,
      }
    }),

    petRoute(ROUTES.config, async () => {
      const global = repository.global
      // Report the model Pet WOULD use, which is the Host's default selection,
      // not a Pet-owned copy. Reading it through the same resolver the
      // coordinator uses keeps the panel honest even when the Host default
      // changes underneath. A resolver failure is not fatal to reading config.
      const followed = deps.followedModel?.()
      // Deliberately projects only non-secret routing selections.
      return {
        providerId: followed?.providerId ?? global.providerId,
        modelId: followed?.modelId ?? global.modelId,
        agentPreset: global.agentPreset,
        defaultContextPolicy: global.defaultContextPolicy,
        workspaceId: global.workspaceId,
      }
    }),

    petRoute(ROUTES.configUpdate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, [
        'providerId',
        'modelId',
        'agentPreset',
        'defaultContextPolicy',
      ])
      const policy = optionalString(record, 'defaultContextPolicy')
      if (policy !== undefined && policy !== 'current-session' && policy !== 'none') {
        throw new PetError('INVALID_REQUEST', 'defaultContextPolicy must be current-session or none', {
          defaultContextPolicy: 'invalid',
        })
      }
      const providerId = optionalString(record, 'providerId')
      const modelId = optionalString(record, 'modelId')
      const agentPreset = optionalString(record, 'agentPreset')
      const updated = await repository.updateGlobal(current => ({
        ...current,
        ...(providerId !== undefined ? { providerId } : {}),
        ...(modelId !== undefined ? { modelId } : {}),
        ...(agentPreset !== undefined ? { agentPreset } : {}),
        ...(policy !== undefined ? { defaultContextPolicy: policy } : {}),
      }))
      return {
        providerId: updated.providerId,
        modelId: updated.modelId,
        agentPreset: updated.agentPreset,
        defaultContextPolicy: updated.defaultContextPolicy,
      }
    }),

    petRoute(ROUTES.capabilities, async () => ({
      capabilities: capabilities.project(repository),
    })),

    petRoute(ROUTES.skills, async () => ({
      revisions: repository.listSkillRevisions(),
      selections: repository.listSkillSelections(),
      projection: await detectProjectionDrift(paths, desiredProjection(repository)),
    })),

    petRoute(ROUTES.skillInspect, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['path'])
      // The ONLY route accepting a filesystem path, and it is read-only.
      const inspection = await inspectBundle(requireString(record, 'path'))
      return {
        skillName: inspection.skillName,
        description: inspection.description,
        whenToUse: inspection.whenToUse,
        digest: inspection.digest,
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
        files: inspection.files,
        canonicalSourcePath: inspection.canonicalSourcePath,
        alreadyInstalled:
          repository.getSkillRevision(inspection.skillName, inspection.digest) !== undefined,
      }
    }),

    petRoute(ROUTES.skillImport, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['path', 'expectedDigest'])
      const inspection = await inspectBundle(requireString(record, 'path'))
      // Second, separately confirmed step: the client echoes the digest it
      // showed the user, so a source changed since inspection is rejected.
      const expected = requireString(record, 'expectedDigest')
      if (expected !== inspection.digest) {
        throw new PetError(
          'SKILL_IMPORT_REJECTED',
          `Skill bundle changed since inspection (expected ${expected}, found ${inspection.digest})`,
        )
      }
      await installBundle(inspection, paths.storeRoot, paths.stagingRoot)
      const revision = await repository.putSkillRevision({
        skillName: inspection.skillName,
        digest: inspection.digest,
        description: inspection.description,
        // An imported Skill declares its own Pet presentation and context
        // requirement; Pet ships no per-capability adapter.
        ...(inspection.pet !== undefined ? { pet: inspection.pet } : {}),
        provenance: {
          kind: 'local-import',
          sourcePath: inspection.canonicalSourcePath,
          installedAt: Date.now(),
        },
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
      })
      deps.changes.publish()
      return { revision }
    }),

    petRoute(ROUTES.skillMutate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['skillName', 'action', 'digest', 'showAsShortcut'])
      const skillName = requireString(record, 'skillName')
      const action = requireString(record, 'action')
      const selection = repository.getSkillSelection(skillName)

      switch (action) {
        case 'enable':
        case 'upgrade': {
          const digest = requireString(record, 'digest')
          if (repository.getSkillRevision(skillName, digest) === undefined) {
            throw new PetError('SKILL_NOT_FOUND', `Revision ${skillName}@${digest} is not installed`)
          }
          await repository.putSkillSelection({
            skillName,
            enabledDigest: digest,
            showAsShortcut: selection?.showAsShortcut ?? true,
          })
          break
        }
        case 'disable': {
          await repository.putSkillSelection({
            skillName,
            showAsShortcut: selection?.showAsShortcut ?? true,
          })
          break
        }
        case 'shortcut': {
          const visible = record['showAsShortcut']
          if (typeof visible !== 'boolean') {
            throw new PetError('INVALID_REQUEST', 'showAsShortcut must be a boolean')
          }
          await repository.putSkillSelection({
            skillName,
            ...(selection?.enabledDigest !== undefined
              ? { enabledDigest: selection.enabledDigest }
              : {}),
            showAsShortcut: visible,
          })
          break
        }
        case 'uninstall': {
          // Two distinct steps, in this order. First remove the skill from
          // future use and from the shortcut menu; only then collect what is
          // physically unreferenced. A revision fixed by an unarchived Task or
          // a non-terminal Invocation is retained, so queued work keeps
          // running the exact version it was accepted with.
          await repository.putSkillSelection({ skillName, showAsShortcut: false })

          for (const revision of collectableRevisions(repository)) {
            if (revision.skillName !== skillName) continue
            await removeRevisionDirectory(paths.storeRoot, revision.skillName, revision.digest)
            await repository.deleteSkillRevision(revision.skillName, revision.digest)
          }
          break
        }
        default:
          throw new PetError('INVALID_REQUEST', `Unknown skill action '${action}'`)
      }

      // Republish so the projection matches the new allowlist immediately.
      const projection = await rebuildProjection(paths, desiredProjection(repository))
      deps.changes.publish()
      return {
        selections: repository.listSkillSelections(),
        projection,
        skillSetGeneration: repository.global.skillSetGeneration,
      }
    }),

    petRoute(ROUTES.projectionRebuild, async () => {
      requireReady(lifecycle)
      return { projection: await rebuildProjection(paths, desiredProjection(repository)) }
    }),

    petRoute(ROUTES.tasks, async () => ({
      tasks: repository.listTasks().map(task => ({
        ...task,
        invocations: repository.listInvocations(task.id),
      })),
    })),

    petRoute(ROUTES.taskDetail, async ({ body }) => {
      const record = strictBody(body, ['taskId'])
      const taskId = requireString(record, 'taskId')
      const task = repository.getTask(taskId)
      if (task === undefined) {
        throw new PetError('TASK_NOT_FOUND', `Pet Task ${taskId} does not exist`)
      }
      const invocations = repository.listInvocations(taskId)
      return {
        task,
        invocations,
        snapshots: invocations.flatMap(invocation => {
          const snapshot = repository.getSnapshot(invocation.snapshotId)
          return snapshot === undefined ? [] : [snapshot]
        }),
        runs: invocations.flatMap(invocation => repository.listRuns(invocation.id)),
      }
    }),

    petRoute(ROUTES.invocationCreate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, [
        'clientInvocationId',
        'capabilityId',
        'sourceKind',
        'sourceSessionId',
        'sourceWorkspaceId',
        'sessionTitle',
        'workspaceTitle',
        'request',
      ])
      const sourceKind = requireString(record, 'sourceKind')
      if (sourceKind !== 'session' && sourceKind !== 'workspace' && sourceKind !== 'none') {
        throw new PetError('INVALID_REQUEST', 'sourceKind must be session, workspace or none')
      }
      const sourceSessionId = optionalString(record, 'sourceSessionId')
      const sourceWorkspaceId = optionalString(record, 'sourceWorkspaceId')
      const userRequest = optionalString(record, 'request')
      const accepted = await coordinator.accept({
        clientInvocationId: requireString(record, 'clientInvocationId'),
        capabilityId: requireString(record, 'capabilityId'),
        sourceKind: sourceKind as PetSourceKind,
        ...(sourceSessionId !== undefined ? { sourceSessionId } : {}),
        ...(sourceWorkspaceId !== undefined ? { sourceWorkspaceId } : {}),
        ...(userRequest !== undefined ? { request: userRequest } : {}),
      })
      deps.changes.publish()
      return accepted
    }),

    petRoute(ROUTES.invocationAnswer, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['taskId', 'answer'])
      await coordinator.answer(requireString(record, 'taskId'), requireString(record, 'answer'))
      deps.changes.publish()
      return { ok: true }
    }),

    petRoute(ROUTES.invocationCancel, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['taskId'])
      await coordinator.cancel(requireString(record, 'taskId'))
      deps.changes.publish()
      return { ok: true }
    }),

    petRoute(ROUTES.invocationRetry, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['invocationId'])
      const invocation = await coordinator.retry(requireString(record, 'invocationId'))
      deps.changes.publish()
      return { invocation }
    }),

    petRoute(ROUTES.taskArchive, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['taskId', 'revision'])
      const revision = record['revision']
      if (revision !== undefined && typeof revision !== 'number') {
        throw new PetError('INVALID_REQUEST', 'revision must be a number')
      }
      // Archiving from Pet must SYNC the executor session; calling the
      // repository directly would leave the executor live and the two sides
      // diverged.
      const task = await archiveTaskFromPet(
        repository,
        deps.archiveSink,
        requireString(record, 'taskId'),
        revision as number | undefined,
      )
      deps.changes.publish()
      return { task }
    }),

    petRoute(ROUTES.bindings, async () => ({
      bindings: repository.listWorkspaceBindings(),
    })),

    petRoute(ROUTES.bindingsUpdate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['workspaceId', 'business', 'crGroupId', 'reviewers'])
      const reviewers = record['reviewers']
      if (
        reviewers !== undefined &&
        (!Array.isArray(reviewers) || reviewers.some(item => typeof item !== 'string'))
      ) {
        throw new PetError('BINDING_INVALID', 'reviewers must be an array of strings', {
          reviewers: 'invalid',
        })
      }
      const binding = await repository.putWorkspaceBinding({
        workspaceId: requireString(record, 'workspaceId'),
        ...(optionalString(record, 'business') !== undefined
          ? { business: optionalString(record, 'business') }
          : {}),
        ...(optionalString(record, 'crGroupId') !== undefined
          ? { crGroupId: optionalString(record, 'crGroupId') }
          : {}),
        ...(reviewers !== undefined ? { reviewers: reviewers as string[] } : {}),
        updatedAt: Date.now(),
      })
      return { binding }
    }),

    petRoute(ROUTES.diagnostics, async () => ({
      lifecycle: lifecycle.state,
      paths: {
        stateRoot: paths.stateRoot,
        databaseFile: paths.databaseFile,
        workspaceRoot: paths.workspaceRoot,
        projectionRoot: paths.projectionRoot,
        storeRoot: paths.storeRoot,
      },
      allowlist: currentAllowlist(repository),
      drift: await detectProjectionDrift(paths, desiredProjection(repository)),
      skillSetGeneration: repository.global.skillSetGeneration,
    })),
  ]
}
