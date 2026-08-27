import type { AbortOptions } from '../core/index.js'

const sendAttempts = new WeakMap<object, () => void>()

/** Host-internal delivery evidence; never enters the stable Core contract. */
export function bindSendAttempt(options: AbortOptions | undefined, callback: () => void): AbortOptions {
  const bound: AbortOptions = options?.signal === undefined ? {} : { signal: options.signal }
  sendAttempts.set(bound, callback)
  return bound
}

export function sendAttemptOf(options: AbortOptions | undefined): (() => void) | undefined {
  return options === undefined ? undefined : sendAttempts.get(options)
}

/** Test/transport hook that marks the exact boundary where a send is attempted. */
export function notifySendAttempt(options: AbortOptions | undefined): void {
  sendAttemptOf(options)?.()
}
