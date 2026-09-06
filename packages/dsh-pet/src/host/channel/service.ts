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
import { createLarkCliClient, type LarkClient } from './lark.js'
import { InboundPipeline, type IntakeOutcome } from './pipeline.js'
import type { WorkspaceLocator } from './route.js'
import { ChannelSubscription, type ChannelStatus } from './subscription.js'
import type { PetCoordinator } from '../coordinator.js'
import type { PetRepository } from '../repository.js'
import type { ChannelControl } from '../routes.js'

/** What the channel needs from its Host. */
export interface ChannelServiceDeps {
  readonly repository: PetRepository
  readonly coordinator: PetCoordinator
  readonly locator: WorkspaceLocator
  /** Overridable for tests; defaults to the real lark-cli client. */
  readonly client?: LarkClient
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
      watermark: () => this.subscription.watermark,
      onOutcome: outcome => this.onOutcome(outcome),
    })
    this.bootstrap = new BotBootstrap({
      ...(deps.spawnProcess !== undefined ? { spawnProcess: deps.spawnProcess } : {}),
      onState: state => {
        this.binding = state
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
    this.subscription.start()
  }

  /** Stop the subscription and release the consumer. */
  stop(): void {
    this.subscription.stop()
  }

  status(): { phase: ChannelStatus['phase']; diagnostic?: string } {
    const current = this.subscription.current
    return {
      phase: current.phase,
      ...(current.diagnostic !== undefined ? { diagnostic: current.diagnostic } : {}),
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) this.subscription.start()
    else this.subscription.stop()
  }

  reconnect(): void {
    this.subscription.reconnect()
  }

  bindState(): BootstrapState | undefined {
    return this.binding
  }

  async beginCreate(): Promise<BootstrapState> {
    const state = await this.bootstrap.createNew()
    await this.recordBinding(state)
    return state
  }

  async connectExisting(appId: string, appSecret: string): Promise<BootstrapState> {
    const state = await this.bootstrap.connectExisting(appId, appSecret)
    await this.recordBinding(state)
    return state
  }

  cancelBind(): void {
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

  /** Persist identity facts after a successful binding. */
  private async recordBinding(state: BootstrapState): Promise<void> {
    if (state.phase !== 'bound' || state.appId === undefined) return
    const config = this.deps.repository.getChannelConfig()
    // Only the app id is known at this point. The bot's own open_id is proven
    // later, from the first group message, against this very app id.
    await this.deps.repository.putChannelConfig({
      ...config,
      botAppId: state.appId,
      updatedAt: Date.now(),
    })
    this.deps.onChange?.()
  }

  /** React to a subscription state change. */
  private onStatus(status: ChannelStatus): void {
    this.log(`subscription ${status.phase}${status.diagnostic !== undefined ? `: ${status.diagnostic}` : ''}`)
    this.deps.onChange?.()
  }

  /** Record an intake outcome and publish visible ones. */
  private onOutcome(outcome: IntakeOutcome): void {
    if (outcome.kind === 'ignored') return
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
