/**
 * Measured entrance-readability, for truthful capability declarations.
 *
 * The incident's second-order defect was a prompt that promised a capability
 * nobody had verified: the delivery said the agent could read Feishu because
 * the bot identity was ready, while the entrance read in fact failed. "Identity
 * ready" is a transport fact, not a read capability.
 *
 * The measurement is bounded and cancellable:
 * - a deadline turns a slow probe into `unconfirmed` (declared as unknown, not
 *   as readable);
 * - an aborted delivery (or a rebuilt/disabled entrance) discards the result;
 * - a probe that answers AFTER the deadline is ignored rather than adopted, so
 *   a declaration can never be rewritten by a late success.
 *
 * The probe's contract is deliberately boolean: it must not hand back message
 * content, which is what keeps a capability check from becoming a way to read
 * the entrance without going through the caller-bound read tool.
 */

/** What a delivery may truthfully say about reading this entrance. */
export type EntranceReadability = 'readable' | 'unreadable' | 'unconfirmed'

/** One bounded read attempt against the exact entrance. */
export interface EntranceReadProbe {
  /**
   * @param input - Exact entrance plus the caller's abort signal, when the
   * caller has a lifecycle to cancel against (the channel admission path has
   * none, the locus delivery path does).
   * @returns whether a real read of this entrance succeeded.
   */
  (input: {
    readonly chatId: string
    readonly threadId?: string
    readonly signal?: AbortSignal
  }): Promise<boolean>
}

/** Probe inputs. */
export interface MeasureEntranceReadabilityInput {
  readonly chatId: string
  readonly threadId?: string
  /** Cancellation source; omit when nothing can cancel this delivery. */
  readonly signal?: AbortSignal
}

/** Probe options; a missing probe can only ever yield `unconfirmed`. */
export interface MeasureEntranceReadabilityOptions {
  readonly probe?: EntranceReadProbe | undefined
  /** Upper bound on the measurement; defaults to {@link ENTRANCE_PROBE_DEADLINE_MS}. */
  readonly deadlineMs?: number
}

/** Default measurement deadline: long enough for one CLI read, short enough to render. */
export const ENTRANCE_PROBE_DEADLINE_MS = 5_000

/**
 * Measure whether this entrance can be read right now.
 * @param input - Entrance and caller signal.
 * @param options - Probe and deadline.
 * @returns the measured state; never a cached or assumed value.
 */
export async function measureEntranceReadability(
  input: MeasureEntranceReadabilityInput,
  options: MeasureEntranceReadabilityOptions,
): Promise<EntranceReadability> {
  const probe = options.probe
  // No probe means the Host cannot prove anything about this entrance.
  if (probe === undefined) return 'unconfirmed'
  const signal = input.signal
  if (signal?.aborted === true) return 'unconfirmed'

  const deadlineMs = options.deadlineMs ?? ENTRANCE_PROBE_DEADLINE_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await new Promise<EntranceReadability>(resolve => {
      let settled = false
      const finish = (value: EntranceReadability): void => {
        if (settled) return
        settled = true
        resolve(value)
      }
      timer = setTimeout(() => finish('unconfirmed'), deadlineMs)
      if (signal !== undefined) {
        onAbort = () => finish('unconfirmed')
        signal.addEventListener('abort', onAbort, { once: true })
      }
      probe({
        chatId: input.chatId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        ...(signal === undefined ? {} : { signal }),
      }).then(
        succeeded => finish(succeeded ? 'readable' : 'unreadable'),
        // A refused or failed probe is "not readable", not "unknown": the
        // system tried and did not get the content.
        () => finish('unreadable'),
      )
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined && signal !== undefined) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

/** The model-facing sentence for one measured state. */
export function describeEntranceReadability(state: EntranceReadability): string {
  switch (state) {
    case 'readable':
      return '本入口的历史消息已实测可读（bot 身份）。'
    case 'unreadable':
      return '本入口的历史消息当前不可读（实测被拒或失败）；请如实说明该限制，不要假装读过。'
    default:
      return '本入口的历史消息可读性未确认（探测超时或被取消）；如未取得内容，请如实说明未确认。'
  }
}

/**
 * Adapt a Lark client's optional probe to the measurement port.
 * @param client - Anything exposing the optional `probeEntranceRead` method.
 * @returns the probe, or `undefined` when the transport cannot measure.
 */
export function entranceReadProbeFor(client: {
  probeEntranceRead?(input: {
    readonly chatId: string
    readonly threadId?: string
  }): Promise<boolean>
}): EntranceReadProbe | undefined {
  const probe = client.probeEntranceRead
  if (probe === undefined) return undefined
  return input => probe.call(client, {
    chatId: input.chatId,
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
  })
}
