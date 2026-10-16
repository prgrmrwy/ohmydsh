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
import { MessageDedup, parseInboundLine } from './event.js'
import { createDocCommentIntake, type DocCommentIntakeOutcome } from './doc-comment-intake.js'
import type { LocusControllerResult, NormalizedLocusAdmission } from './locus-controller.js'
import { PairingController, type PairingControllerOptions } from './pairing.js'
import type { WorkspaceLocator } from './route.js'
import { RELOGIN_DIAGNOSTIC, runConnectionGate, type ConnectionGatePort } from './connection-gate.js'
import {
  ChannelSubscription,
  type ChannelStatus,
  type SubscriptionOptions,
} from './subscription.js'
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
  readonly locusToolTier?: (endpoint: import('../locus/admission.js').LocusEndpoint) => 'safe' | 'shell' | undefined
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
  /** Explicit catalog/provisioning diagnostic when lifecycle intake is unavailable. */
  readonly botLifecycleDiagnostic?: string
  /**
   * Overridable process spawn for the binding flow.
   *
   * Injected rather than reached for directly so binding can be exercised
   * without launching a real authorization flow.
   */
  readonly spawnProcess?: SpawnLike
  /** Injectable event-consumer process/timer seams for service integration tests. */
  /**
   * Doc-comment intake for `drive.notice.comment_add_v1` lines from the shared
   * `+subscribe` connection. Absent means comments are dropped silently.
   * Tests may pass a raw handler; production composes {@link docCommentLocus}.
   */
  readonly commentIntake?: (line: string) => Promise<void>
  /**
   * The locus controller's pre-admitted entry. When present (and no raw
   * `commentIntake` overrides it), the service builds the comment driver with
   * its OWN live state: the formal-run flag, a stop signal, the watermark and
   * the same dedup/authorization the IM pipeline uses.
   */
  readonly docCommentLocus?: {
    handleAdmission(admission: NormalizedLocusAdmission): Promise<LocusControllerResult>
  }
  readonly subscriptionSpawnProcess?: SubscriptionOptions['spawnProcess']
  readonly subscriptionSchedule?: SubscriptionOptions['schedule']
  /** Injectable pairing randomness/clock/timer seams for deterministic tests. */
  readonly pairing?: Pick<PairingControllerOptions, 'now' | 'randomBytes' | 'schedule'>
  /** Notified whenever channel state changes, so the UI can refresh. */
  readonly onChange?: () => void
  /** Structured logging sink. */
  readonly log?: (message: string) => void
}

/** The composed Lark channel. */
export class ChannelService implements ChannelControl {
  private readonly client: LarkClient
  private readonly subscription: ChannelSubscription
  private readonly pipeline: InboundPipeline
  private readonly pairing: PairingController
  private readonly bootstrap: BotBootstrap
  private binding: BootstrapState | undefined
  private permission: LarkPermissionDiagnostic | undefined
  private identityDiagnostic: string | undefined
  private readonly ignoredAt = new Map<string, number>()
  /** The formal Channel reason is armed only after its latest identity probe. */
  private formalReady = false
  /** Aborted whenever the formal channel stops; renewed on each formal start. */
  private commentStop = new AbortController()
  private readonly commentDedup = new MessageDedup()
  private readonly docCommentIntake: ((line: string) => Promise<void>) | undefined
  /** Fences async identity probes after disable, teardown, or a newer request. */
  private operationGeneration = 0
  /** Fences pairing start probes independently from formal enable/binding work. */
  private pairingGeneration = 0

  /**
   * @param deps - Host collaborators.
   */
  constructor(private readonly deps: ChannelServiceDeps) {
    this.client = deps.client ?? createLarkCliClient()
    this.subscription = new ChannelSubscription({
      onLine: line => {
        // Fire-and-forget: intake is async, and the consumer stream must not
        // wait on Pet's storage or an Agent dispatch.
        void this.dispatchLine(line).catch(error => {
          this.log(`intake failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      },
      onStatus: status => this.onStatus(status),
      ...(deps.subscriptionSpawnProcess !== undefined
        ? { spawnProcess: deps.subscriptionSpawnProcess }
        : {}),
      ...(deps.subscriptionSchedule !== undefined
        ? { schedule: deps.subscriptionSchedule }
        : {}),
      gate: signal => runConnectionGate(this.gatePort(), signal),
    })
    // Bot-added has no consumer in production (index.ts never wires an
    // initializer), and a separate subscription would be a SECOND event
    // connection for the app, which splits events (pet-locus-doc-comments D1).
    // If it is ever needed, route it through the one `+subscribe` instead.
    const commentLocus = deps.docCommentLocus
    this.docCommentIntake = commentLocus === undefined || deps.locusAuthorization === undefined
      ? undefined
      : createDocCommentIntake({
        client: this.client,
        admissionContext: () => {
          const config = deps.repository.getChannelConfig()
          const authorization = deps.locusAuthorization
          if (authorization === undefined) return undefined
          return {
            ...(config.botOpenId === undefined ? {} : { botOpenId: config.botOpenId }),
            allowOpenIds: config.allowOpenIds,
            watermark: this.subscription.watermark,
            isDuplicate: messageId => this.commentDedup.check(messageId),
            authorization,
            ...(deps.locusToolTier === undefined && authorization.toolTier === undefined
              ? {}
              : { toolTier: deps.locusToolTier ?? authorization.toolTier }),
          }
        },
        handleAdmission: admission => commentLocus.handleAdmission(admission),
        active: () => this.formalReady,
        signal: () => this.commentStop.signal,
        onOutcome: outcome => this.onCommentOutcome(outcome),
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
      ...(deps.locusToolTier !== undefined ? { locusToolTier: deps.locusToolTier } : {}),
      watermark: () => this.subscription.watermark,
      onOutcome: outcome => this.onOutcome(outcome),
    })
    this.pairing = new PairingController({
      repository: deps.repository,
      client: this.client,
      ...(deps.pairing?.now !== undefined ? { now: deps.pairing.now } : {}),
      ...(deps.pairing?.randomBytes !== undefined
        ? { randomBytes: deps.pairing.randomBytes }
        : {}),
      ...(deps.pairing?.schedule !== undefined ? { schedule: deps.pairing.schedule } : {}),
      onChange: () => deps.onChange?.(),
      onRunReasonChange: () => this.reconcileSubscription(),
      log: reason => this.log(reason),
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
    this.pairingGeneration += 1
    this.setFormalReady(false)
    this.bootstrap.cancel()
    this.pairing.stop()
    // Stop receiving new events even when a durable claim must finish.
    this.subscription.stop()
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

  pairingState() {
    return this.pairing.publicState
  }

  async startPairing(): Promise<void> {
    const generation = ++this.pairingGeneration
    // Replacement invalidates the old bearer synchronously, before network
    // preflight can yield and leave it usable longer than the user intended.
    if (!this.pairing.cancel()) {
      throw new Error('Pairing is already committing an allowed member; wait for it to finish.')
    }
    const config = this.deps.repository.getChannelConfig()
    if (config.botAppId === undefined || config.botOpenId === undefined) {
      throw new Error('Bind and verify a Lark bot before starting pairing.')
    }
    const version = await this.client.cliVersion?.()
    if (generation !== this.pairingGeneration) return
    if (version !== undefined && !version.supported) {
      const found = version.version === undefined ? 'unknown' : version.version
      throw new Error(`lark-cli ${found} is unsupported; upgrade to 1.0.97 or later.`)
    }
    const probe = this.client.botIdentity
    if (probe === undefined) throw new Error('The Pet lark-cli profile cannot verify the bound bot.')
    const identity = await probe.call(this.client, config.botAppId)
    if (generation !== this.pairingGeneration) return
    if (identity.kind !== 'ready' || identity.identity.openId !== config.botOpenId) {
      throw new Error(
        identity.kind === 'ready'
          ? 'The verified Pet bot identity does not match the configured bot.'
          : identity.diagnostic,
      )
    }
    // Re-read the mutable identity after the network await. A reconnect may
    // have replaced the bound app while the probe was running.
    const latest = this.deps.repository.getChannelConfig()
    if (latest.botAppId !== config.botAppId || latest.botOpenId !== config.botOpenId) {
      throw new Error('The configured bot changed while pairing was starting.')
    }
    this.pairing.start()
    // Pair start is an explicit user operation and may recover a supervisor
    // that previously exhausted its retry budget.
    if (this.subscription.current.phase === 'down') this.subscription.reconnect()
    else if (this.subscription.current.phase === 'connected') this.pairing.activate()
  }

  cancelPairing(): void {
    if (!this.pairing.cancel()) {
      throw new Error('Pairing is already committing an allowed member; wait for it to finish.')
    }
    this.pairingGeneration += 1
  }

  async setEnabled(enabled: boolean, replace = false): Promise<void> {
    const generation = ++this.operationGeneration
    if (!enabled) {
      this.setFormalReady(false)
      this.reconcileSubscription()
      return
    }
    // Revalidation is itself fail-closed: an already-running formal consumer
    // loses that run reason until the latest identity proof succeeds.
    this.setFormalReady(false)
    this.reconcileSubscription()
    const config = this.requireReadyConfig()
    const version = await this.client.cliVersion?.()
    if (generation !== this.operationGeneration) return
    if (version !== undefined && !version.supported) {
      const found = version.version === undefined ? 'unknown' : version.version
      this.identityDiagnostic = `lark-cli ${found} is unsupported; upgrade to 1.0.97 or later.`
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
    // IM intake preconditions: formal start (incl. Host-start restore), enable
    // and explicit reconnect all come through here; supervisor restarts and
    // pairing-only spawns do not (pet-locus-doc-comments D2).
    const preconditions = await this.client.imPreconditions?.()
    if (generation !== this.operationGeneration) return
    if (preconditions !== undefined && preconditions.blocked.length > 0) {
      this.identityDiagnostic = preconditions.blocked.includes('credentials_available')
        ? RELOGIN_DIAGNOSTIC
        : `lark-cli reports blocked IM preconditions: ${preconditions.blocked.join(', ')}.`
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
    this.setFormalReady(true)
    if (replace && this.subscription.current.phase !== 'stopped') this.subscription.reconnect()
    else this.reconcileSubscription()
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
    if (!this.pairing.cancel()) {
      throw new Error('Pairing is already committing an allowed member; wait before reconnecting the bot.')
    }
    this.pairingGeneration += 1
    const resume = this.deps.repository.getChannelConfig().enabled
    this.setFormalReady(false)
    this.reconcileSubscription()
    if (resume) {
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
        diagnostic: `lark-cli ${found} is unsupported; upgrade to 1.0.97 or later.`,
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
    this.setFormalReady(resume)
    if (resume) {
      this.subscription.reconnect()
    } else {
      this.reconcileSubscription()
    }
  }

  /** Parse once, give pairing first refusal, then preserve ordinary intake. */
  private async dispatchLine(line: string): Promise<void> {
    // One connection carries both event families; route by the compact `type`.
    if (isCommentLine(line)) {
      // Comments never reach the IM pipeline, pairing, or a disabled channel.
      const intake = this.deps.commentIntake ?? this.docCommentIntake
      if (this.formalReady && intake !== undefined) await intake(line)
      return
    }
    const event = parseInboundLine(line)
    if (event === undefined) {
      await this.pipeline.handleLine(line)
      return
    }
    if (await this.pairing.handle(event)) return
    await this.pipeline.handleEvent(event)
  }

  /** Live outside-world operations for the spawn gate. */
  private gatePort(): ConnectionGatePort {
    return {
      cliVersion: async () => (await this.client.cliVersion?.())?.version,
      connectionCount: async () =>
        (await this.client.eventConnectionCount?.()) ?? { kind: 'error', authFailure: false },
      sleep: (ms, signal) =>
        new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('aborted'))
            return
          }
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }, ms)
          const onAbort = (): void => {
            clearTimeout(timer)
            reject(new Error('aborted'))
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }),
    }
  }

  /** Low-cardinality comment diagnostics; never ids or content. */
  private onCommentOutcome(outcome: DocCommentIntakeOutcome): void {
    if (outcome.kind === 'ignored') {
      const reason = safeIgnoredReason(outcome.reason)
      const now = Date.now()
      const previous = this.ignoredAt.get(`comment:${reason}`) ?? 0
      if (now - previous >= 60_000) {
        this.ignoredAt.set(`comment:${reason}`, now)
        this.log(`comment ignored: ${reason}`)
      }
      return
    }
    if (outcome.kind === 'handled' && outcome.result.kind === 'refused') {
      this.log(`comment unroutable: ${outcome.result.reason}`)
    }
    this.deps.onChange?.()
  }

  /**
   * The single writer of `formalReady`. Leaving the formal run aborts every
   * in-flight comment query/retry; entering it issues a fresh signal, so a
   * stale retry from a previous run can never accept, reply or react.
   */
  private setFormalReady(ready: boolean): void {
    if (ready && !this.formalReady) this.commentStop = new AbortController()
    if (!ready && this.formalReady) this.commentStop.abort()
    this.formalReady = ready
  }

  /** Start or stop the ONE consumer from the union of active run reasons. */
  private reconcileSubscription(): void {
    const shouldRun = this.formalReady || this.pairing.requiresConsumer
    if (shouldRun) {
      // `down` is terminal until an explicit user operation calls reconnect;
      // pairing cleanup must not reset the supervisor's failure budget.
      if (this.subscription.current.phase !== 'down') this.subscription.start()
      if (this.subscription.current.phase === 'connected') this.pairing.activate()
    } else {
      this.subscription.stop()
    }
  }

  /** React to a subscription state change. */
  private onStatus(status: ChannelStatus): void {
    this.log(`subscription ${status.phase}${status.diagnostic !== undefined ? `: ${status.diagnostic}` : ''}`)
    if (status.phase === 'connected') this.pairing.activate()
    if (status.phase === 'down' && this.pairing.requiresConsumer) {
      this.pairing.fail(status.diagnostic ?? '无法连接飞书事件订阅，请稍后重试。')
    }
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
  // Comment pipeline (pet-locus-doc-comments D13). Gate reasons are channel
  // state, not per-event ignores, and stay out of this set.
  'comment-scope-unknown',
  'comment-reply-missing',
  'unsupported-file-type',
])

/** Map internal detail to a stable low-cardinality diagnostic vocabulary. */
export function safeIgnoredReason(reason: string): string {
  const mapped =
    reason === 'before-watermark'
      ? 'too-old'
      : reason === 'unsupported-message-type'
        ? 'unsupported-type'
        : reason
  return SAFE_IGNORED.has(mapped) ? mapped : 'other'
}

/** Whether a `+subscribe --compact` line is a doc-comment event. */
function isCommentLine(line: string): boolean {
  if (!line.includes('drive.notice.comment_add_v1')) return false
  try {
    const value = JSON.parse(line) as { type?: unknown }
    return value !== null && typeof value === 'object' && value.type === 'drive.notice.comment_add_v1'
  } catch {
    return false
  }
}
