/**
 * Contained Pet Host lifecycle.
 *
 * The Pet Host runs as a service inside the existing `dsh web` Node process.
 * `apply` therefore stays registration-only and every fallible asynchronous
 * initialization step is contained here, so a Pet failure degrades Pet alone
 * and never aborts unrelated DSH capabilities.
 */

import type { PetLifecycle, PetLifecycleState } from '../wire.js'

/** Notified on every lifecycle transition so the Web client never polls. */
export type PetLifecycleListener = (state: PetLifecycleState) => void

/**
 * Owns the `starting → ready | degraded → stopping` state machine.
 *
 * Transitions are monotonic per generation: once `stopping` is entered, later
 * `ready`/`degraded` reports from in-flight initialization work are ignored so
 * a slow async step cannot resurrect a shut-down Pet.
 */
export class PetLifecycleMachine {
  private phase: PetLifecycle = 'starting'
  private diagnostic: string | undefined
  private generation = 1
  private readonly listeners = new Set<PetLifecycleListener>()

  /** Current immutable lifecycle projection. */
  get state(): PetLifecycleState {
    return this.diagnostic === undefined
      ? { phase: this.phase, generation: this.generation }
      : { phase: this.phase, diagnostic: this.diagnostic, generation: this.generation }
  }

  /** Whether Pet may accept work right now. */
  get isReady(): boolean {
    return this.phase === 'ready'
  }

  /**
   * Subscribe to lifecycle transitions.
   * @param listener - Called with each new state.
   * @returns a disposer removing the listener.
   */
  subscribe(listener: PetLifecycleListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Mark initialization successful. Ignored once stopping. */
  markReady(): void {
    if (this.phase === 'stopping') return
    this.transition('ready', undefined)
  }

  /**
   * Mark Pet degraded with a diagnostic. Ignored once stopping.
   * @param diagnostic - Operator-facing reason; must not contain secrets.
   */
  markDegraded(diagnostic: string): void {
    if (this.phase === 'stopping') return
    this.transition('degraded', diagnostic)
  }

  /** Enter the terminal stopping phase. */
  markStopping(): void {
    this.transition('stopping', this.diagnostic)
  }

  /**
   * Run a fallible initialization step under containment.
   *
   * A rejection degrades Pet with the step's diagnostic rather than
   * propagating into the Host's plugin `apply`.
   * @param label - Short step name used in the degraded diagnostic.
   * @param step - The fallible asynchronous work.
   * @returns the step result, or `undefined` when it failed.
   */
  async contain<T>(label: string, step: () => Promise<T>): Promise<T | undefined> {
    try {
      return await step()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.markDegraded(`${label}: ${reason}`)
      return undefined
    }
  }

  private transition(phase: PetLifecycle, diagnostic: string | undefined): void {
    if (this.phase === phase && this.diagnostic === diagnostic) return
    this.phase = phase
    this.diagnostic = diagnostic
    this.generation += 1
    const snapshot = this.state
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // A misbehaving listener must not break the lifecycle machine.
      }
    }
  }
}
