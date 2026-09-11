/**
 * The Lark channel as one Host-owned service.
 *
 * Ties the pieces together — subscription, intake pipeline, binding flow and
 * terminal feedback — behind the small control surface the management routes
 * drive. Keeping the assembly here rather than in `index.ts` means the whole
 * channel can be composed, or left out, as a unit.
 *
 * Failure is contained by construction: nothing in this file can reject into
 * Pet's startup path, and the subscription's own state machine keeps a broken
 * Lark link from touching the mascot, the panel or any existing capability.
 */

import { BotBootstrap, type BootstrapState, type SpawnLike } from './bootstrap.js'
import {
  createLarkCliClient,
  type LarkClient,
  type LarkPermissionDiagnostic,
} from './lark.js'
import { InboundPipeline, type IntakeOutcome } from './pipeline.js'
import type { LocusChannelControllerPort } from './locus-capability.js'
import type { WorkspaceLocator } from './route.js'
import { ChannelSubscription, type ChannelStatus } from './subscription.js'
import {
  BOT_ADDED_EVENT_KEY,
  BotLifecycleIntake,
  type BotLifecycleInitializer,
} from './bot-lifecycle.js'
import type { PetCoordinator } from '../coordinator.js'
import type { PetRepository } from '../repository.js'
import type { PetChannelConfig } from '../spec.js'
import type { PetUnifiedLocusReadiness } from '../../wire.js'
import type { LocusAuthorizationResolver } from '../locus/admission.js'
import type { ChannelControl } from '../routes.js'

/** What the channel needs from its Host. */
export interface ChannelServiceDeps {
  readonly repository: PetRepository
  readonly coordinator: PetCoordinator
  readonly locator: WorkspaceLocator
  /** Overridable for tests; defaults to the real lark-cli client. */
  readonly client?: LarkClient
  /**
   * Opt-in unified locus path. When present, InboundPipeline routes every
   * Feishu business message through this controller and never consults the
   * legacy QA/chat/Invocation path.
   */
  readonly locusController?: LocusChannelControllerPort
  /** Durable unified/legacy-retirement authorization for exact endpoints. */
  readonly locusAuthorization?: LocusAuthorizationResolver
  /**
   * Optional diagnostic for a Host that knows unified locus was requested but
   * could not compose its durable/observer/child capability. It is surfaced
   * without changing bootstrap or subscription semantics; absent capability
   * still means no unified route is published.
   */
  readonly locusDiagnostic?: string
  /**
   * Explicit Host capability proof. Production normally derives this from the
   * fully composed controller; tests/adapters may provide the same proof
   * directly without fabricating a controller.
   */
  readonly unifiedLocusReadiness?: PetUnifiedLocusReadiness
  /** Independent chat-level initialization for verified bot-added events. */
  readonly botLifecycleInitializer?: BotLifecycleInitializer
  /** Explicit catalog/provisioning diagnostic when lifecycle intake is unavailable. */
  readonly botLifecycleDiagnostic?: string
  /** Shared injectable spawn for event consumers in tests. */
  readonly subscriptionSpawnProcess?: ConstructorParameters<typeof ChannelSubscription>[0]['spawnProcess']
  /**
   * Overridable process spawn for the binding flow.
   *
   * Injected rather than reached for directly so binding can be exercised
   * without launching a real authorization flow.
   */
  readonly spawnProcess?: SpawnLike
  /** Notified whenever channel state changes, so the UI can refresh. */
  readonly onChange?: () => void
  /** Structured logging sink. */
  readonly log?: (message: string) => void
}

/** The composed Lark channel. */
export class ChannelService implements ChannelControl {
  private readonly client: LarkClient
  private readonly subscription: ChannelSubscription
  private readonly lifecycleSubscription: ChannelSubscription | undefined
  private readonly lifecycleIntake: BotLifecycleIntake | undefined
  private readonly pipeline: InboundPipeline
  private readonly bootstrap: BotBootstrap
  private binding: BootstrapState | undefined
  private permission: LarkPermissionDiagnostic | undefined
  private identityDiagnostic: string | undefined
  private lifecycleDiagnostic: string | undefined
  private readonly ignoredAt = new Map<string, number>()
  /** Fences async identity probes after disable, teardown, or a newer request. */
  private operationGeneration = 0

  /**
   * @param deps - Host collaborators.
   */
  constructor(private readonly deps: ChannelServiceDeps) {
    this.client = deps.client ?? createLarkCliClient()
    this.subscription = new ChannelSubscription({
      ...(deps.subscriptionSpawnProcess === undefined ? {} : { spawnProcess: deps.subscriptionSpawnProcess }),
      onLine: line => {
        // Fire-and-forget: intake is async, and the consumer stream must not
        // wait on Pet's storage or an Agent dispatch.
        void this.pipeline.handleLine(line).catch(error => {
          this.log(`intake failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      },
      onStatus: status => this.onStatus(status),
    })
    this.lifecycleIntake = deps.botLifecycleInitializer === undefined
      ? undefined
      : new BotLifecycleIntake({
        allowOpenIds: () => deps.repository.getChannelConfig().allowOpenIds,
        initializer: deps.botLifecycleInitializer,
      })
    this.lifecycleSubscription = this.lifecycleIntake === undefined
      ? undefined
      : new ChannelSubscription({
        eventKey: BOT_ADDED_EVENT_KEY,
        ...(deps.subscriptionSpawnProcess === undefined ? {} : { spawnProcess: deps.subscriptionSpawnProcess }),
        onLine: line => {
          void this.lifecycleIntake!.handleLine(line).then(outcome => {
            if (outcome.kind === 'unverified') {
              this.lifecycleDiagnostic =
                'Bot 入群事件缺少 allowlist 操作者证明；该群保持待建立，首次 allowlist @ 可补齐。'
              void deps.repository.updateChannelConfig(current => ({
                ...current,
                lifecycleDiagnostic: { kind: 'bot-added-unverified', updatedAt: Date.now() },
              })).catch(() => undefined)
              this.log('bot-added event lacked allowlisted operator proof; first allowlist @ remains required')
              deps.onChange?.()
            } else if (outcome.kind === 'initialized') {
              this.lifecycleDiagnostic = undefined
              void deps.repository.updateChannelConfig(current => {
                const { lifecycleDiagnostic: _cleared, ...rest } = current
                return rest
              }).catch(() => undefined)
              deps.onChange?.()
            }
          }).catch(error => {
            this.log(`bot lifecycle intake failed: ${error instanceof Error ? error.message : String(error)}`)
          })
        },
        onStatus: () => deps.onChange?.(),
      })
    this.pipeline = new InboundPipeline({
      repository: deps.repository,
      coordinator: deps.coordinator,
      client: this.client,
      locator: deps.locator,
      ...(deps.locusController !== undefined ? { locusController: deps.locusController } : {}),
      // Production is a breaking cutover: an absent unified controller is an
      // unavailable channel, never permission to enter the retained legacy
      // root/Invocation/QA branches below the pipeline boundary.
      requireLocus: true,
      ...(deps.locusAuthorization !== undefined ? { locusAuthorization: deps.locusAuthorization } : {}),
      watermark: () => this.subscription.watermark,
      onOutcome: outcome => this.onOutcome(outcome),
    })
    this.bootstrap = new BotBootstrap({
      ...(deps.spawnProcess !== undefined ? { spawnProcess: deps.spawnProcess } : {}),
      onState: state => {
        // A successful config-init is internal until the named profile proves
        // the expected app/open_id. Never publish a transient false `bound`.
        if (state.phase !== 'bound') this.binding = state
        deps.onChange?.()
      },
    })
  }

  /**
   * Start the subscription when configuration says it should run.
   *
   * Never throws: a channel that cannot start leaves the rest of Pet intact.
   */
  start(): void {
    if (!this.deps.repository.getChannelConfig().enabled) return
    void this.setEnabled(true).catch(error => {
      this.log(`subscription refused: ${error instanceof Error ? error.message : String(error)}`)
      this.deps.onChange?.()
    })
  }

  /** Stop the subscription and release the consumer. */
  stop(): void {
    this.operationGeneration += 1
    this.bootstrap.cancel()
    this.subscription.stop()
    this.lifecycleSubscription?.stop()
    // The unified controller owns only its observer subscription/pending map;
    // disposing it never releases a locus child or sends parent/business text.
    try {
      this.deps.locusController?.dispose()
    } catch {
      // Teardown is fail-soft like the subscription itself.
    }
  }

  status(): {
    phase: ChannelStatus['phase']
    diagnostic?: string
    permission?: LarkPermissionDiagnostic
    identityDiagnostic?: string
    unifiedLocus: PetUnifiedLocusReadiness
  } {
    const current = this.subscription.current
    const config = this.deps.repository.getChannelConfig()
    const stored = config.channelDiagnostic
    const durableLifecycle = config.lifecycleDiagnostic?.kind === 'bot-added-unverified'
      ? 'Bot 入群事件缺少 allowlist 操作者证明；该群保持待建立，首次 allowlist @ 可补齐。'
      : undefined
    const diagnostic =
      this.deps.locusDiagnostic ??
      current.diagnostic ??
      this.lifecycleSubscription?.current.diagnostic ??
      this.lifecycleDiagnostic ??
      durableLifecycle ??
      this.deps.botLifecycleDiagnostic
    const permission =
      this.permission ??
      (stored?.kind === 'permission-missing'
        ? {
            ...(stored.code !== undefined ? { code: stored.code } : {}),
            missingScopes: stored.missingScopes,
            ...(stored.consoleUrl !== undefined ? { consoleUrl: stored.consoleUrl } : {}),
          }
        : undefined)
    const unifiedLocus: PetUnifiedLocusReadiness =
      this.deps.unifiedLocusReadiness ??
      (this.deps.locusController === undefined
        ? {
            childSession: 'unavailable',
            defaultPermission: 'read',
            readVerification: 'unavailable',
            diagnostic:
              this.deps.locusDiagnostic ??
              '当前 Host 尚未发布完整的统一子会话、轮次关联与只读策略核验能力。',
          }
        : {
            childSession: 'verified',
            defaultPermission: 'read',
            readVerification: 'verified',
          })
    return {
      phase: current.phase,
      ...(diagnostic !== undefined ? { diagnostic } : {}),
      ...(permission !== undefined ? { permission } : {}),
      ...(this.identityDiagnostic !== undefined
        ? { identityDiagnostic: this.identityDiagnostic }
        : {}),
      unifiedLocus,
    }
  }

  workspaceAvailable(workspaceId: string): boolean {
    return this.deps.locator.locate(workspaceId) !== undefined
  }

  async setEnabled(enabled: boolean, replace = false): Promise<void> {
    const generation = ++this.operationGeneration
    if (!enabled) {
      this.subscription.stop()
      this.lifecycleSubscription?.stop()
      return
    }
    const config = this.requireReadyConfig()
    const version = await this.client.cliVersion?.()
    if (generation !== this.operationGeneration) return
    if (version !== undefined && !version.supported) {
      const found = version.version === undefined ? 'unknown' : version.version
      this.identityDiagnostic = `lark-cli ${found} is unsupported; upgrade to 1.0.93 or later.`
      throw new Error(this.identityDiagnostic)
    }
    const probe = this.client.botIdentity
    if (probe === undefined) {
      this.identityDiagnostic = 'The Pet lark-cli profile cannot verify the bound bot.'
      throw new Error(this.identityDiagnostic)
    }
    const identity = await probe.call(this.client, config.botAppId)
    if (generation !== this.operationGeneration) return
    if (identity.kind !== 'ready' || identity.identity.openId !== config.botOpenId) {
      this.identityDiagnostic =
        identity.kind === 'ready'
          ? 'The verified Pet bot identity does not match the configured bot.'
          : identity.diagnostic
      this.deps.onChange?.()
      throw new Error(this.identityDiagnostic)
    }
    // Recheck every mutable prerequisite after the network await.
    this.requireReadyConfig()
    this.identityDiagnostic = undefined
    this.permission = undefined
    await this.deps.repository.updateChannelConfig(current => {
      const { channelDiagnostic: _staleDiagnostic, ...clean } = current
      return { ...clean, updatedAt: Date.now() }
    })
    if (generation !== this.operationGeneration) return
    if (!this.deps.repository.getChannelConfig().enabled) return
    if (replace) {
      this.subscription.reconnect()
      this.lifecycleSubscription?.reconnect()
    } else {
      this.subscription.start()
      this.lifecycleSubscription?.start()
    }
  }

  async reconnect(): Promise<void> {
    await this.setEnabled(true, true)
  }

  private requireReadyConfig(): PetChannelConfig & {
    readonly botAppId: string
    readonly botOpenId: string
  } {
    const config = this.deps.repository.getChannelConfig()
    if (!config.enabled) throw new Error('The Lark channel is disabled.')
    if (config.botAppId === undefined || config.botOpenId === undefined) {
      throw new Error('Bind and verify a Lark bot before starting the channel.')
    }
    if (config.allowOpenIds.length === 0) throw new Error('Add at least one permitted sender.')
    if (
      config.defaultWorkspaceId === undefined ||
      !this.workspaceAvailable(config.defaultWorkspaceId)
    ) {
      throw new Error('Choose an available default workspace for automatic main sessions.')
    }
    const unifiedLocus = this.status().unifiedLocus
    if (
      unifiedLocus.childSession !== 'verified' ||
      unifiedLocus.readVerification !== 'verified'
    ) {
      throw new Error(
        unifiedLocus.diagnostic ??
        'Verify unified child-session creation and the effective read policy before enabling the channel.',
      )
    }
    return config as PetChannelConfig & { readonly botAppId: string; readonly botOpenId: string }
  }

  bindState(): BootstrapState | undefined {
    return this.binding
  }

  async beginCreate(): Promise<BootstrapState> {
    const attempt = await this.prepareBinding()
    if (attempt.generation !== this.operationGeneration) return { phase: 'idle' }
    const state = await this.bootstrap.createNew()
    await this.recordBinding(state, attempt.generation, attempt.resume)
    return attempt.generation === this.operationGeneration
      ? (this.binding ?? state)
      : { phase: 'idle' }
  }

  async connectExisting(appId: string, appSecret: string): Promise<BootstrapState> {
    const attempt = await this.prepareBinding()
    if (attempt.generation !== this.operationGeneration) return { phase: 'idle' }
    const state = await this.bootstrap.connectExisting(appId, appSecret)
    await this.recordBinding(state, attempt.generation, attempt.resume)
    return attempt.generation === this.operationGeneration
      ? (this.binding ?? state)
      : { phase: 'idle' }
  }

  private async prepareBinding(): Promise<{ generation: number; resume: boolean }> {
    const generation = ++this.operationGeneration
    const resume = this.deps.repository.getChannelConfig().enabled
    if (resume) {
      this.subscription.stop()
      this.lifecycleSubscription?.stop()
      await this.deps.repository.updateChannelConfig(current =>
        generation === this.operationGeneration
          ? { ...current, enabled: false, updatedAt: Date.now() }
          : current,
      )
    }
    return { generation, resume }
  }

  cancelBind(): void {
    this.operationGeneration += 1
    this.bootstrap.cancel()
  }

  /**
   * Apply the terminal reaction.
   *
   * Called by the Host's event projection when an Invocation settles. Safe to
   * call for any Invocation: work with no channel binding is ignored.
   * @param invocationId - The settled Invocation.
   * @param outcome - How it ended.
   */
  async settle(_invocationId: string, _outcome: 'succeeded' | 'failed'): Promise<void> {
    // Ordinary Pet Invocation events still exist for the wheel, but production
    // Feishu work no longer creates invocation_channel rows. Unified Delivery
    // feedback is owned exclusively by LocusChannelController's exact turn
    // observer, so this compatibility hook must never consume legacy rows.
  }

  /** Persist identity facts only after the named profile proves them. */
  private async recordBinding(
    state: BootstrapState,
    generation: number,
    resumeRequested: boolean,
  ): Promise<void> {
    if (
      generation !== this.operationGeneration ||
      state.phase !== 'bound' ||
      state.appId === undefined
    ) return
    const version = await this.client.cliVersion?.()
    if (generation !== this.operationGeneration) return
    if (version !== undefined && !version.supported) {
      const found = version.version === undefined ? 'unknown' : version.version
      this.binding = {
        phase: 'failed',
        diagnostic: `lark-cli ${found} is unsupported; upgrade to 1.0.93 or later.`,
      }
      this.deps.onChange?.()
      return
    }
    const probe = this.client.botIdentity
    if (probe === undefined) {
      this.binding = {
        phase: 'failed',
        diagnostic: 'This lark-cli integration cannot verify the Pet bot identity.',
      }
      this.deps.onChange?.()
      return
    }
    const identity = await probe.call(this.client, state.appId)
    if (generation !== this.operationGeneration) return
    if (identity.kind !== 'ready') {
      this.binding = { phase: 'failed', diagnostic: identity.diagnostic }
      this.deps.onChange?.()
      return
    }
    let resume = false
    await this.deps.repository.updateChannelConfig(current => {
      if (generation !== this.operationGeneration) return current
      resume =
        resumeRequested &&
        current.allowOpenIds.length > 0 &&
        current.defaultWorkspaceId !== undefined &&
        this.workspaceAvailable(current.defaultWorkspaceId)
      const { channelDiagnostic: _staleDiagnostic, ...clean } = current
      return {
        ...clean,
        // An invalid legacy enabled row is repaired rather than revived.
        enabled: resume,
        botAppId: identity.identity.appId,
        botOpenId: identity.identity.openId,
        ...(identity.identity.name !== undefined ? { botName: identity.identity.name } : {}),
        updatedAt: Date.now(),
      }
    })
    if (generation !== this.operationGeneration) return
    this.binding = { phase: 'bound', appId: identity.identity.appId }
    this.identityDiagnostic = undefined
    this.permission = undefined
    this.deps.onChange?.()
    // The profile may now identify another app: always replace a live consumer.
    if (resume) this.subscription.reconnect()
  }

  /** React to a subscription state change. */
  private onStatus(status: ChannelStatus): void {
    this.log(`subscription ${status.phase}${status.diagnostic !== undefined ? `: ${status.diagnostic}` : ''}`)
    this.deps.onChange?.()
  }

  /** Record an intake outcome without logging any external identifiers. */
  private onOutcome(outcome: IntakeOutcome): void {
    if (outcome.kind === 'ignored') {
      const diagnostic = outcome.diagnostic
      if (outcome.reason === 'bot-identity-unresolved' && diagnostic !== undefined) {
        this.permission = diagnostic
        void this.deps.repository
          .updateChannelConfig(current => ({
            ...current,
            channelDiagnostic: {
              kind: 'permission-missing',
              ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
              missingScopes: [...diagnostic.missingScopes],
              ...(diagnostic.consoleUrl !== undefined
                ? { consoleUrl: diagnostic.consoleUrl }
                : {}),
              updatedAt: Date.now(),
            },
            updatedAt: Date.now(),
          }))
          .then(() => this.deps.onChange?.())
          .catch(() => undefined)
      }
      // One line per reason per minute keeps this useful under noisy groups.
      const reason = safeIgnoredReason(outcome.reason)
      const now = Date.now()
      const previous = this.ignoredAt.get(reason) ?? 0
      if (now - previous >= 60_000) {
        this.ignoredAt.set(reason, now)
        this.log(`inbound ignored: ${reason}`)
      }
      return
    }
    if (outcome.kind === 'unroutable' || outcome.kind === 'error') {
      this.log(`inbound ${outcome.kind}: ${outcome.reason}`)
      return
    }
    if (outcome.kind === 'control') {
      if (!outcome.ok) this.log(`control refused: ${outcome.reason ?? 'unknown'}`)
      this.deps.onChange?.()
      return
    }
    this.deps.onChange?.()
  }

  /** Emit a namespaced log line. */
  private log(message: string): void {
    this.deps.log?.(`dsh-pet channel: ${message}`)
  }
}

const SAFE_IGNORED = new Set([
  'disabled',
  'not-allowed-sender',
  'no-mention',
  'too-old',
  'duplicate',
  'unsupported-type',
  'bot-identity-unresolved',
  'bot-sender',
  'empty-content',
  'unparsable',
])

/** Map internal detail to a stable low-cardinality diagnostic vocabulary. */
function safeIgnoredReason(reason: string): string {
  const mapped =
    reason === 'before-watermark'
      ? 'too-old'
      : reason === 'unsupported-message-type'
        ? 'unsupported-type'
        : reason
  return SAFE_IGNORED.has(mapped) ? mapped : 'other'
}
