export interface InquiryAgentResolverScope {
  readonly kind: 'main' | 'child'
  readonly sessionId: string
}

export interface InquiryAgentResolverPorts<TAgent extends { readonly id: string }> {
  getLive(sessionId: string): TAgent | undefined
  resumeMain(sessionId: string, signal: AbortSignal): Promise<void>
  parentSessionOf(childSessionId: string): string | undefined
  materializeChild(parent: TAgent, childSessionId: string, signal: AbortSignal): Promise<void>
  log(message: string): void
  timeoutMs?: number
}

export function createInquiryAgentResolver<TAgent extends { readonly id: string }>(
  ports: InquiryAgentResolverPorts<TAgent>,
): (scope: InquiryAgentResolverScope) => Promise<TAgent | undefined> {
  const inFlight = new Map<string, Promise<TAgent | undefined>>()
  const timeoutMs = ports.timeoutMs ?? 30_000

  const live = (id: string): TAgent | undefined => {
    const candidate = ports.getLive(id)
    return candidate?.id === id ? candidate : undefined
  }

  const recover = async (scope: InquiryAgentResolverScope): Promise<TAgent | undefined> => {
    const id = scope.sessionId
    const existing = live(id)
    if (existing !== undefined) return existing

    const runWithTimeout = async (operation: (signal: AbortSignal) => Promise<void>): Promise<boolean> => {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          operation(controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort()
              reject(new Error('timeout'))
            }, timeoutMs)
          }),
        ])
        return !controller.signal.aborted
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    try {
      if (scope.kind === 'main') {
        if (!(await runWithTimeout(signal => ports.resumeMain(id, signal)))) return undefined
        return live(id)
      }
      const parentId = ports.parentSessionOf(id)
      if (parentId === undefined) return undefined
      let parent = live(parentId)
      if (parent === undefined) {
        if (!(await runWithTimeout(signal => ports.resumeMain(parentId, signal)))) return undefined
        parent = live(parentId)
        if (parent === undefined) return undefined
      }
      const exactParent = parent
      if (!(await runWithTimeout(signal => ports.materializeChild(exactParent, id, signal)))) return undefined
      return live(id)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      try { ports.log(`inquiry agent recovery failed for ${id}: ${reason}`) } catch { /* fail closed */ }
      return undefined
    }
  }

  return scope => {
    const id = scope.sessionId
    const pending = inFlight.get(id)
    if (pending !== undefined) return pending
    const work = recover(scope).finally(() => {
      if (inFlight.get(id) === work) inFlight.delete(id)
    })
    inFlight.set(id, work)
    return work
  }
}
