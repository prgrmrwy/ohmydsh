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
import { inspectBundle } from './skill-bundle.js'
import { currentAllowlist } from './skill-provider.js'
import { PET_ENV_PREFIX } from './shell-env.js'
import {
  ROUTES,
  PET_ENV_GLOBAL,
  type PetBindState,
  type PetChannelPhase,
  type PetChannelView,
  type PetChatRoute,
  type PetSourceKind,
  type PetWorkspaceChoice,
} from '../wire.js'

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
  /** Agent presets this Host offers, for the Settings picker. */
  readonly listPresets?: () => Promise<readonly { id: string; label: string }[]>
  /**
   * Workspaces this Host knows, for the environment tab's picker.
   *
   * Shown with title and path: a user configuring "the CR group for project
   * A" recognizes the project, not an opaque generated id.
   */
  readonly listWorkspaces?: () => Promise<readonly PetWorkspaceChoice[]>
  /** Inspects the Workspace files an executor session depends on. */
  readonly inspectWorkspace?: () => Promise<{ ok: boolean; problems: readonly string[] }>
  /** Restores those files, returning what could not be repaired. */
  readonly repairWorkspace?: () => Promise<{ ok: boolean; problems: readonly string[] }>
  /**
   * The Lark channel, when this Host composed one.
   *
   * Optional so a Pet without the channel keeps every other route working:
   * the settings tab reports it unavailable instead of the Host failing.
   */
  readonly channel?: ChannelControl
}

/** What the channel routes drive. */
export interface ChannelControl {
  /** Live connection state for diagnostics. */
  status(): { phase: PetChannelPhase; diagnostic?: string }
  /** Apply an enabled/disabled decision, starting or stopping the consumer. */
  setEnabled(enabled: boolean): Promise<void>
  /** Restart a downed subscription on explicit request. */
  reconnect(): void
  /** Current binding-flow state, when one has run. */
  bindState(): PetBindState | undefined
  /** Begin creating a new Lark app; resolves when the flow settles. */
  beginCreate(): Promise<PetBindState>
  /** Bind an existing app; the secret is consumed, never stored. */
  connectExisting(appId: string, appSecret: string): Promise<PetBindState>
  /** Abort an in-flight binding flow. */
  cancelBind(): void
}

/**
 * Project the channel's stored state for the settings tab.
 *
 * Assembles ONLY identity facts and routing. There is no branch here that
 * could emit a credential, because the stored configuration has no field to
 * hold one.
 * @param repository - Pet repository.
 * @param channel - Channel control, when composed.
 * @returns the view.
 */
function channelView(
  repository: PetRepository,
  channel: ChannelControl | undefined,
): PetChannelView {
  const config = repository.getChannelConfig()
  const routes: PetChatRoute[] = repository.listChatBindings().map(binding => ({
    chatId: binding.chatId,
    chatType: binding.chatType,
    ...(binding.chatName !== undefined ? { chatName: binding.chatName } : {}),
    workspaceId: binding.workspaceId,
    ...(binding.activeTaskId !== undefined ? { activeTaskId: binding.activeTaskId } : {}),
    boundBy: binding.boundBy,
    boundAt: binding.boundAt,
  }))

  // Work waiting behind current work, across every chat-sourced Task. Shown
  // so a backlog is visible rather than looking like the channel is stuck.
  let queueDepth = 0
  for (const task of repository.listTasks()) {
    if (task.sourceKind !== 'chat' || task.archivedAt !== undefined) continue
    queueDepth += repository
      .listInvocations(task.id)
      .filter(invocation => invocation.status === 'queued').length
  }

  const status = channel?.status() ?? { phase: 'stopped' as const }
  const binding = channel?.bindState()
  return {
    enabled: config.enabled,
    ...(config.botAppId !== undefined
      ? {
          bot: {
            appId: config.botAppId,
            ...(config.botName !== undefined ? { name: config.botName } : {}),
            ...(config.botOpenId !== undefined ? { openId: config.botOpenId } : {}),
          },
        }
      : {}),
    allowOpenIds: config.allowOpenIds,
    knownNames: config.knownNames ?? {},
    ...(config.defaultWorkspaceId !== undefined
      ? { defaultWorkspaceId: config.defaultWorkspaceId }
      : {}),
    routes,
    connection: {
      phase: status.phase,
      ...(status.diagnostic !== undefined ? { diagnostic: status.diagnostic } : {}),
      queueDepth,
    },
    ...(binding !== undefined ? { binding } : {}),
  }
}

/** Desired projection derived from the current allowlist. */
function desiredProjection(
  repository: PetRepository,
): readonly { skillName: string; sourcePath: string }[] {
  return currentAllowlist(repository).map(entry => ({
    skillName: entry.skillName,
    sourcePath: entry.sourcePath,
  }))
}

/** Longest free-text argument string accepted for one Skill. */
const MAX_ARGUMENTS_CHARS = 500

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
        // Always the Host's default selection: Pet follows DSH rather than
        // keeping its own copy. The write route no longer accepts these, so
        // reading a stored value back would only report a stale ghost.
        providerId: followed?.providerId,
        modelId: followed?.modelId,
        agentPreset: global.agentPreset,
        defaultContextPolicy: global.defaultContextPolicy,
        appearance: global.appearance,
        workspaceId: global.workspaceId,
      }
    }),

    petRoute(ROUTES.configUpdate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, [
        'agentPreset',
        'defaultContextPolicy',
        'appearance',
      ])

      // Appearance is display state, but it must round-trip exactly: accept
      // only the known fields and coerce nothing else.
      const rawAppearance = record['appearance']
      let appearance: Record<string, string> | undefined
      if (rawAppearance !== undefined) {
        if (typeof rawAppearance !== 'object' || rawAppearance === null) {
          throw new PetError('INVALID_REQUEST', 'appearance must be an object')
        }
        const source = rawAppearance as Record<string, unknown>
        appearance = {}
        for (const key of ['accent', 'glyph', 'size', 'ringStyle'] as const) {
          if (typeof source[key] === 'string') appearance[key] = source[key]
        }
      }
      const policy = optionalString(record, 'defaultContextPolicy')
      if (policy !== undefined && policy !== 'current-session' && policy !== 'none') {
        throw new PetError('INVALID_REQUEST', 'defaultContextPolicy must be current-session or none', {
          defaultContextPolicy: 'invalid',
        })
      }
      // Normalize blank to undefined: storing `''` is indistinguishable from
      // "unset" to a reader using `??`, and DSH rejects it as a preset name.
      const rawPreset = optionalString(record, 'agentPreset')
      const agentPreset = rawPreset?.trim() === '' ? undefined : rawPreset
      const updated = await repository.updateGlobal(current => ({
        ...current,
        ...(agentPreset !== undefined ? { agentPreset } : {}),
        ...(policy !== undefined ? { defaultContextPolicy: policy } : {}),
        // Merge, so setting one field does not clear the others.
        ...(appearance !== undefined
          ? { appearance: { ...(current.appearance ?? {}), ...appearance } }
          : {}),
      }))
      return {
        providerId: updated.providerId,
        modelId: updated.modelId,
        agentPreset: updated.agentPreset,
        appearance: updated.appearance,
        defaultContextPolicy: updated.defaultContextPolicy,
      }
    }),

    petRoute(ROUTES.workspaceRepair, async () => {
      // Explicit, user-applied repair. Sessions also self-heal on creation,
      // but a visible action lets the user fix a reported problem directly.
      const health = (await deps.repairWorkspace?.()) ?? { ok: true, problems: [] }
      deps.changes.publish()
      return { ok: health.ok, problems: health.problems }
    }),

    petRoute(ROUTES.presets, async () => ({
      presets: (await deps.listPresets?.()) ?? [],
    })),

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
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
        files: inspection.files,
        canonicalSourcePath: inspection.canonicalSourcePath,
        alreadyInstalled: repository.getSkillRevision(inspection.skillName) !== undefined,
      }
    }),

    petRoute(ROUTES.skillImport, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['path', 'arguments'])
      // Registration links the user's own directory; nothing is copied, so a
      // later edit to that directory takes effect immediately.
      const inspection = await inspectBundle(requireString(record, 'path'))

      // Free-text arguments, appended after the skill token on dispatch. Pet
      // stores them verbatim and never parses them.
      const rawArguments = record['arguments']
      if (rawArguments !== undefined && typeof rawArguments !== 'string') {
        throw new PetError('INVALID_REQUEST', 'arguments must be a string')
      }
      const skillArguments = (rawArguments ?? '').trim().slice(0, MAX_ARGUMENTS_CHARS)

      const revision = await repository.putSkillRevision({
        skillName: inspection.skillName,
        sourcePath: inspection.canonicalSourcePath,
        description: inspection.description,
        ...(skillArguments === '' ? {} : { arguments: skillArguments }),
        provenance: {
          kind: 'local-link',
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
      const record = strictBody(body, ['skillName', 'action', 'showAsShortcut', 'arguments'])
      const skillName = requireString(record, 'skillName')
      const action = requireString(record, 'action')
      const selection = repository.getSkillSelection(skillName)

      switch (action) {
        case 'enable': {
          if (repository.getSkillRevision(skillName) === undefined) {
            throw new PetError('SKILL_NOT_FOUND', `Skill ${skillName} is not registered`)
          }
          await repository.putSkillSelection({
            skillName,
            enabled: true,
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
            ...(selection?.enabled === true ? { enabled: true } : {}),
            showAsShortcut: visible,
          })
          break
        }
        case 'arguments': {
          // Editable after install: the right arguments are usually only
          // discovered by running the Skill once.
          const raw = record['arguments']
          if (raw !== undefined && typeof raw !== 'string') {
            throw new PetError('INVALID_REQUEST', 'arguments must be a string')
          }
          const revision = repository.getSkillRevision(skillName)
          if (revision === undefined) {
            throw new PetError('SKILL_NOT_FOUND', `Skill ${skillName} is not registered`)
          }
          const next = (raw ?? '').trim().slice(0, MAX_ARGUMENTS_CHARS)
          // Rebuild without the key when cleared: `exactOptionalPropertyTypes`
          // distinguishes an absent field from an explicit `undefined`.
          const { arguments: _dropped, ...rest } = revision
          await repository.putSkillRevision(
            next === '' ? rest : { ...rest, arguments: next },
          )
          break
        }
        case 'remove': {
          // Drop the registration and its selection. The user's own directory
          // is never touched — Pet only ever held a link to it.
          await repository.putSkillSelection({ skillName, showAsShortcut: false })
          await repository.deleteSkillRevision(skillName)
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


    petRoute(ROUTES.petEnv, async () => ({
      // Both scopes in one response so the UI can mark which workspace entries
      // shadow a global one without a second round trip.
      entries: repository.listEnvEntries(),
      workspaces: (await deps.listWorkspaces?.()) ?? [],
      globalScope: PET_ENV_GLOBAL,
      prefix: PET_ENV_PREFIX,
    })),

    petRoute(ROUTES.petEnvMutate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['scope', 'key', 'value', 'action'])
      const action = requireString(record, 'action')
      const scope = requireString(record, 'scope')
      const key = requireString(record, 'key')

      // `global` is a reserved scope name, so it must not arrive as a
      // workspace id: that would silently write the global set while the user
      // believed they were configuring one workspace.
      const rawScope = record['scope']
      if (typeof rawScope !== 'string' || rawScope.trim() === '') {
        throw new PetError('BINDING_INVALID', 'scope must be "global" or a workspace id')
      }

      switch (action) {
        case 'set': {
          const value = record['value']
          if (typeof value !== 'string') {
            throw new PetError('BINDING_INVALID', 'value must be a string')
          }
          // The repository validates key shape and non-empty value, so the
          // rule lives in exactly one place.
          await repository.putEnvEntry({ scope, key, value: value.trim(), updatedAt: Date.now() })
          break
        }
        case 'remove': {
          await repository.deleteEnvEntry(scope, key)
          break
        }
        default:
          throw new PetError('BINDING_INVALID', `Unknown env action '${action}'`)
      }

      deps.changes.publish()
      return { entries: repository.listEnvEntries() }
    }),

    petRoute(ROUTES.channel, async () => channelView(repository, deps.channel)),

    petRoute(ROUTES.channelMutate, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, [
        'action',
        'enabled',
        'allowOpenIds',
        'defaultWorkspaceId',
        'chatId',
        'workspaceId',
      ])
      const action = requireString(record, 'action')
      const config = repository.getChannelConfig()

      switch (action) {
        case 'set-enabled': {
          const enabled = record['enabled']
          if (typeof enabled !== 'boolean') {
            throw new PetError('BINDING_INVALID', 'enabled must be a boolean')
          }
          // Refuse to arm a channel that has no identity to check mentions
          // against or no one permitted to use it: an "enabled" channel that
          // silently admits nobody is worse than an honest refusal.
          if (enabled && config.botAppId === undefined) {
            throw new PetError('BINDING_INVALID', 'Bind a Lark bot before enabling the channel.')
          }
          if (enabled && config.allowOpenIds.length === 0) {
            throw new PetError(
              'BINDING_INVALID',
              'Add at least one permitted sender before enabling the channel.',
            )
          }
          await repository.putChannelConfig({ ...config, enabled, updatedAt: Date.now() })
          await deps.channel?.setEnabled(enabled)
          break
        }
        case 'set-allowlist': {
          const raw = record['allowOpenIds']
          if (!Array.isArray(raw) || raw.some(entry => typeof entry !== 'string')) {
            throw new PetError('BINDING_INVALID', 'allowOpenIds must be an array of open ids')
          }
          // The repository rejects anything that is not a resolved open id, so
          // an unusable allowlist cannot be stored looking configured.
          await repository.putChannelConfig({
            ...config,
            allowOpenIds: raw as string[],
            updatedAt: Date.now(),
          })
          break
        }
        case 'set-default-workspace': {
          const workspaceId = optionalString(record, 'defaultWorkspaceId')
          await repository.putChannelConfig({
            ...config,
            ...(workspaceId === undefined ? {} : { defaultWorkspaceId: workspaceId }),
            updatedAt: Date.now(),
          })
          break
        }
        case 'rebind-chat': {
          const chatId = requireString(record, 'chatId')
          const workspaceId = requireString(record, 'workspaceId')
          const existing = repository.getChatBinding(chatId)
          if (existing === undefined) {
            throw new PetError('BINDING_INVALID', `Chat ${chatId} has no route to rebind.`)
          }
          // Marked `user` so a later default-routed message never silently
          // overwrites a deliberate choice.
          await repository.putChatBinding({
            ...existing,
            workspaceId,
            boundBy: 'user',
            boundAt: Date.now(),
          })
          break
        }
        case 'remove-chat': {
          await repository.deleteChatBinding(requireString(record, 'chatId'))
          break
        }
        case 'reconnect': {
          deps.channel?.reconnect()
          break
        }
        default:
          throw new PetError('BINDING_INVALID', `Unknown channel action '${action}'`)
      }

      deps.changes.publish()
      return channelView(repository, deps.channel)
    }),

    petRoute(ROUTES.channelBind, async ({ body }) => {
      requireReady(lifecycle)
      const record = strictBody(body, ['action', 'appId', 'appSecret'])
      const action = requireString(record, 'action')
      const channel = deps.channel
      if (channel === undefined) {
        throw new PetError('BINDING_INVALID', 'This Pet Host has no Lark channel.')
      }

      switch (action) {
        case 'create': {
          // Deliberately not awaited: creating blocks until the user finishes
          // authorizing in a browser, and the client needs the verification
          // link long before that. Progress is polled through `channel`.
          void channel.beginCreate()
          break
        }
        case 'connect': {
          const appId = requireString(record, 'appId')
          const appSecret = record['appSecret']
          if (typeof appSecret !== 'string' || appSecret.trim() === '') {
            throw new PetError('BINDING_INVALID', 'appSecret is required')
          }
          // Awaited: connecting is a fast local call. The secret goes straight
          // through to lark-cli and is never echoed back in the response.
          await channel.connectExisting(appId, appSecret)
          break
        }
        case 'cancel': {
          channel.cancelBind()
          break
        }
        default:
          throw new PetError('BINDING_INVALID', `Unknown bind action '${action}'`)
      }

      deps.changes.publish()
      return channelView(repository, channel)
    }),

    petRoute(ROUTES.diagnostics, async () => ({
      lifecycle: lifecycle.state,
      workspace: (await deps.inspectWorkspace?.()) ?? { ok: true, problems: [] },
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
