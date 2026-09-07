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
import { settleFeedback } from './feedback.js'
import {
  createLarkCliClient,
  type LarkClient,
  type LarkPermissionDiagnostic,
} from './lark.js'
import {
  InboundPipeline,
  type BindCommandPort,
  type IntakeOutcome,
  type QaDeliveryPort,
} from './pipeline.js'
import type { WorkspaceLocator } from './route.js'
import { ChannelSubscription, type ChannelStatus } from './subscription.js'
import type { PetCoordinator } from '../coordinator.js'
import type { PetRepository } from '../repository.js'
import type { PetChannelConfig } from '../spec.js'
import type { ChannelControl } from '../routes.js'

/** What the channel needs from its Host. */
export interface ChannelServiceDeps {
  readonly repository: PetRepository
  readonly coordinator: PetCoordinator
  readonly locator: WorkspaceLocator
  /** Overridable for tests; defaults to the real lark-cli client. */
  readonly client?: LarkClient
  /**
   * QA delivery, when this Host composed the subagent seam.
   *
   * Absent on a Host without it: a qa binding then refuses rather than
   * falling back to workspace dispatch, which would answer the group from a
   * fresh executor holding none of the context it exists for.
   */
  readonly qaDelivery?: QaDeliveryPort
  /**
   * Handles `/bind` in groups with no QA binding yet.
   *
   * Absent on a Host without QA support, in which case the command is never
   * recognised and those groups behave exactly as before.
   */
  readonly bindCommand?: BindCommandPort
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
  private readonly pipeline: InboundPipeline
  private readonly bootstrap: BotBootstrap
  private binding: BootstrapState | undefined
  private permission: LarkPermissionDiagnostic | undefined
  private identityDiagnostic: string | undefined
  private readonly ignoredAt = new Map<string, number>()
  /** Fences async identity probes after disable, teardown, or a newer request. */
  private operationGeneration = 0

  /**
   * @param deps - Host collaborators.
   */
  constructor(private readonly deps: ChannelServiceDeps) {
    this.client = deps.client ?? createLarkCliClient()
    this.subscription = new ChannelSubscription({
      onLine: line => {
        // Fire-and-forget: intake is async, and the consumer stream must not
        // wait on Pet's storage or an Agent dispatch.
        void this.pipeline.handleLine(line).catch(error => {
          this.log(`intake failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      },
      onStatus: status => this.onStatus(status),
    })
    this.pipeline = new InboundPipeline({
      repository: deps.repository,
      coordinator: deps.coordinator,
      client: this.client,
      locator: deps.locator,
      ...(deps.qaDelivery !== undefined ? { qaDelivery: deps.qaDelivery } : {}),
      ...(deps.bindCommand !== undefined ? { bindCommand: deps.bindCommand } : {}),
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
  }

  status(): {
    phase: ChannelStatus['phase']
    diagnostic?: string
    permission?: LarkPermissionDiagnostic
    identityDiagnostic?: string
  } {
    const current = this.subscription.current
    const stored = this.deps.repository.getChannelConfig().channelDiagnostic
    const permission =
      this.permission ??
      (stored?.kind === 'permission-missing'
        ? {
            ...(stored.code !== undefined ? { code: stored.code } : {}),
            missingScopes: stored.missingScopes,
            ...(stored.consoleUrl !== undefined ? { consoleUrl: stored.consoleUrl } : {}),
          }
        : undefined)
    return {
      phase: current.phase,
      ...(current.diagnostic !== undefined ? { diagnostic: current.diagnostic } : {}),
      ...(permission !== undefined ? { permission } : {}),
      ...(this.identityDiagnostic !== undefined
        ? { identityDiagnostic: this.identityDiagnostic }
        : {}),
    }
  }

  workspaceAvailable(workspaceId: string): boolean {
    return this.deps.locator.locate(workspaceId) !== undefined
  }

  async setEnabled(enabled: boolean, replace = false): Promise<void> {
    const generation = ++this.operationGeneration
    if (!enabled) {
      this.subscription.stop()
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
    if (replace) this.subscription.reconnect()
    else this.subscription.start()
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
      throw new Error('Choose an available default workspace.')
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
  async settle(invocationId: string, outcome: 'succeeded' | 'failed'): Promise<void> {
    try {
      await settleFeedback(this.deps.repository, this.client, invocationId, outcome)
    } catch (error) {
      // Feedback decorates work that already happened; a Lark failure must
      // never rewrite the outcome of that work.
      this.log(`feedback failed: ${error instanceof Error ? error.message : String(error)}`)
    }
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
