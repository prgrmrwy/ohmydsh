/**
 * Host LLM-stream egress gate.
 *
 * Registered on `llm/stream` (the dsh-llm waterfall that wraps every model
 * call before the provider adapter issues the request): Claude-family calls
 * are allowed only when the egress verdict is `'allowed'`; `'blocked'` and
 * `'unknown'` fail closed — the listener throws a stable error and never
 * calls `next()`, so no request reaches Anthropic or any other provider.
 * Non-Claude calls pass through untouched (fail open for everything else).
 *
 * The error text carries only the verdict, never an IP, the Geo response
 * body, endpoints or credentials.
 *
 * @module dsh-home-network-model-guard/egress-gate
 */
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { GuardCheckResult } from './contract.js'
import { isClaudeFamily } from './rules.js'

/** Stable error marker for restricted Claude calls. */
export class EgressRestrictedError extends Error {
  public constructor(public readonly verdict: GuardCheckResult['verdict']) {
    super(`dsh-home-network-model-guard: Claude egress is restricted (${verdict})`)
    this.name = 'EgressRestrictedError'
  }
}

/** Waterfall listener shorthands. */
type Next = () => AsyncIterable<StreamChunk>
type Listener = (options: GenerateOptions, next: Next) => AsyncIterable<StreamChunk>

/**
 * Build the `llm/stream` listener around an injected verdict reader.
 *
 * The verdict reader is invoked per Claude call (the cache answers from the
 * host verdict state; every model-stream entry takes the current conclusion,
 * see design Open Questions). A blocked/unknown verdict short-circuits the
 * waterfall — `next()` is never called.
 *
 * @param check - verdict reader (the host network cache `check`).
 * @returns the waterfall listener.
 */
export function createEgressGate(check: () => Promise<GuardCheckResult>): Listener {
  return (options, next) => {
    if (!isClaudeFamily(options.provider, options.model)) return next()
    const run = (async function* gate(): AsyncIterable<StreamChunk> {
      const result = await check()
      if (result.verdict !== 'allowed') throw new EgressRestrictedError(result.verdict)
      yield* next()
    })()
    return run
  }
}