export const HostActivationState = Object.freeze({
  DISABLED: 'HOST_DISABLED',
  PREPARING: 'HOST_PREPARING',
  READY: 'HOST_READY',
  CONFLICT: 'HOST_CONFLICT',
  FAILED: 'HOST_FAILED',
})

export const ClientActivationState = Object.freeze({
  OFFICIAL: 'CLIENT_OFFICIAL',
  PREPARING: 'CLIENT_PREPARING',
  FEDERATED: 'CLIENT_FEDERATED',
  FALLBACK: 'CLIENT_FALLBACK',
})

export class HostActivationPrototype {
  state = HostActivationState.DISABLED
  applyCount = 0
  failure

  async activate({ prepare, registrations }) {
    if (this.state === HostActivationState.READY) return
    if (this.state !== HostActivationState.DISABLED) throw new Error(`host cannot activate from ${this.state}`)
    this.state = HostActivationState.PREPARING
    this.applyCount += 1
    const disposers = []
    try {
      await prepare()
      for (const register of registrations) disposers.push(await register())
      this.state = HostActivationState.READY
      this.failure = undefined
      this.disposeReady = once(async () => {
        for (const dispose of disposers.reverse()) await dispose()
        this.state = HostActivationState.DISABLED
      })
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      this.failure = error
      this.state = String(error?.code ?? '').includes('CONFLICT')
        ? HostActivationState.CONFLICT
        : HostActivationState.FAILED
    }
  }

  async stop() {
    await this.disposeReady?.()
  }
}

export class ClientActivationPrototype {
  constructor({ clientId, generation, host, slots, contributions }) {
    this.clientId = clientId
    this.generation = generation
    this.host = host
    this.slots = slots
    this.contributions = contributions
    this.state = ClientActivationState.OFFICIAL
    this.disposers = []
    this.stopEntryErrors = slots.onEntryError((key, entry, error, info) => {
      if (!info.abdicated || this.state !== ClientActivationState.FEDERATED) return
      if (!this.federationEntries.has(entry)) return
      this.failure = { kind: 'entry-crash', key, error }
      this.fallback()
    })
    this.federationEntries = new Set()
  }

  async activate(prepare) {
    if (this.state !== ClientActivationState.OFFICIAL) throw new Error(`client cannot activate from ${this.state}`)
    this.state = ClientActivationState.PREPARING
    try {
      if (this.host.state !== HostActivationState.READY) throw new Error('host federation is not ready')
      await prepare()
      const pending = []
      this.disposers = pending
      for (const contribution of this.contributions) {
        const dispose = this.slots.register({
          name: contribution.slot,
          priority: contribution.priority,
          registrant: `federation:${this.clientId}:${this.generation}`,
        }, contribution.component)
        pending.push(dispose)
        const entry = this.slots.entries(contribution.slot).find(candidate => candidate.component === contribution.component)
        if (entry === undefined) throw new Error(`missing registered entry for ${contribution.slot}`)
        this.federationEntries.add(entry)
      }
      this.disposers = pending
      this.state = ClientActivationState.FEDERATED
    } catch (error) {
      this.failure = { kind: 'prepare-or-registration', error }
      this.fallback()
    }
  }

  fallback() {
    for (const dispose of this.disposers.reverse()) dispose()
    this.disposers = []
    this.federationEntries.clear()
    this.state = ClientActivationState.FALLBACK
  }

  dispose() {
    for (const dispose of this.disposers.reverse()) dispose()
    this.disposers = []
    this.federationEntries.clear()
    this.stopEntryErrors()
    this.state = ClientActivationState.OFFICIAL
  }
}

export function createClientGenerationTracker() {
  const generations = new Map()
  return clientId => {
    const generation = (generations.get(clientId) ?? 0) + 1
    generations.set(clientId, generation)
    return generation
  }
}

function once(operation) {
  let done = false
  return async () => {
    if (done) return
    done = true
    await operation()
  }
}
