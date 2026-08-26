import { describe, expect, it } from 'vitest'
import { ClientActivationController, type ClientContribution, type SlotHandle } from '../src/client/activation.js'

interface Entry { readonly slot: string; readonly priority: number; readonly registrant: string; readonly component: unknown }

class FakeSlots implements SlotHandle {
  readonly entries: Entry[] = []
  #listeners: ((key: string, component: unknown, error: unknown, info: { abdicated: boolean }) => void)[] = []
  failOn?: string

  register(descriptor: { name: string; priority: number; registrant: string }, component: unknown) {
    if (this.failOn === descriptor.name) throw new Error(`slot ${descriptor.name} rejected registration`)
    const entry: Entry = { slot: descriptor.name, priority: descriptor.priority, registrant: descriptor.registrant, component }
    this.entries.push(entry)
    return () => {
      const index = this.entries.indexOf(entry)
      if (index >= 0) this.entries.splice(index, 1)
    }
  }

  onEntryError(listener: (key: string, component: unknown, error: unknown, info: { abdicated: boolean }) => void) {
    this.#listeners.push(listener)
    return () => { this.#listeners = this.#listeners.filter(candidate => candidate !== listener) }
  }

  crash(component: unknown, slot: string) {
    for (const listener of [...this.#listeners]) listener(slot, component, new Error('render failed'), { abdicated: true })
  }

  /** The winner is the lowest priority number registered for a slot. */
  winner(slot: string): Entry | undefined {
    return this.entries.filter(entry => entry.slot === slot).sort((a, b) => a.priority - b.priority)[0]
  }
}

const OFFICIAL_SIDEBAR = Symbol('official-sidebar')
const OFFICIAL_HERO = Symbol('official-hero')

function withOfficial(slots: FakeSlots): FakeSlots {
  slots.register({ name: 'sidebar.workspaces', priority: 0, registrant: 'official' }, OFFICIAL_SIDEBAR)
  slots.register({ name: 'conversation.hero.workspace', priority: 0, registrant: 'official' }, OFFICIAL_HERO)
  return slots
}

function contributions(tag: string): ClientContribution[] {
  return [
    { slot: 'sidebar.workspaces', priority: -1, component: `${tag}:sidebar` },
    { slot: 'conversation.hero.workspace', priority: -1, component: `${tag}:hero` },
  ]
}

describe('per-client UI activation (6.8)', () => {
  it('shadows official slots only after this client is ready', async () => {
    const slots = withOfficial(new FakeSlots())
    let ready = false
    const controller = new ClientActivationController({
      clientId: 'tab-1', slots, contributions: contributions('tab-1'),
      isHostReady: () => true,
      prepare: async () => { if (!ready) throw new Error('bridge not ready') },
    })
    expect(slots.winner('sidebar.workspaces')?.component).toBe(OFFICIAL_SIDEBAR)
    expect(await controller.activate()).toMatchObject({ state: 'CLIENT_FALLBACK', diagnostic: /bridge not ready/ })
    expect(slots.winner('sidebar.workspaces')?.component).toBe(OFFICIAL_SIDEBAR)

    ready = true
    const second = new ClientActivationController({
      clientId: 'tab-1', slots, contributions: contributions('tab-1'),
      isHostReady: () => true, prepare: async () => {},
    })
    expect(await second.activate()).toEqual({ state: 'CLIENT_FEDERATED' })
    expect(slots.winner('sidebar.workspaces')?.component).toBe('tab-1:sidebar')
    expect(slots.winner('conversation.hero.workspace')?.component).toBe('tab-1:hero')
  })

  it('refuses to activate while the Host is not READY', async () => {
    const slots = withOfficial(new FakeSlots())
    const controller = new ClientActivationController({
      clientId: 'tab-1', slots, contributions: contributions('tab-1'),
      isHostReady: () => false, prepare: async () => {},
    })
    expect(await controller.activate()).toMatchObject({ state: 'CLIENT_FALLBACK', diagnostic: /host federation is not ready/ })
    expect(slots.entries.every(entry => entry.registrant === 'official')).toBe(true)
  })

  it('keeps one failing client independent from another federated client', async () => {
    const first = withOfficial(new FakeSlots())
    const second = withOfficial(new FakeSlots())
    const good = new ClientActivationController({
      clientId: 'tab-good', slots: first, contributions: contributions('tab-good'),
      isHostReady: () => true, prepare: async () => {},
    })
    const bad = new ClientActivationController({
      clientId: 'tab-bad', slots: second, contributions: contributions('tab-bad'),
      isHostReady: () => true, prepare: async () => { throw new Error('embed build missing') },
    })
    expect(await good.activate()).toEqual({ state: 'CLIENT_FEDERATED' })
    expect(await bad.activate()).toMatchObject({ state: 'CLIENT_FALLBACK' })
    expect(first.winner('sidebar.workspaces')?.component).toBe('tab-good:sidebar')
    expect(second.winner('sidebar.workspaces')?.component).toBe(OFFICIAL_SIDEBAR)
    expect(good.state).toBe('CLIENT_FEDERATED')
  })

  it('falls back on readiness timeout without leaving contributions registered', async () => {
    const slots = withOfficial(new FakeSlots())
    const controller = new ClientActivationController({
      clientId: 'tab-slow', slots, contributions: contributions('tab-slow'), timeoutMs: 5,
      isHostReady: () => true,
      prepare: () => new Promise(resolve => setTimeout(resolve, 50)),
    })
    expect(await controller.activate()).toMatchObject({ state: 'CLIENT_FALLBACK', diagnostic: /timed out/ })
    expect(slots.entries.every(entry => entry.registrant === 'official')).toBe(true)
  })

  it('disposes both federation surfaces when one entry crashes in this client only', async () => {
    const slots = withOfficial(new FakeSlots())
    const controller = new ClientActivationController({
      clientId: 'tab-1', slots, contributions: contributions('tab-1'),
      isHostReady: () => true, prepare: async () => {},
    })
    await controller.activate()
    slots.crash('tab-1:sidebar', 'sidebar.workspaces')
    expect(controller.state).toBe('CLIENT_FALLBACK')
    expect(slots.winner('sidebar.workspaces')?.component).toBe(OFFICIAL_SIDEBAR)
    expect(slots.winner('conversation.hero.workspace')?.component).toBe(OFFICIAL_HERO)
  })

  it('rolls back a partial registration and replaces only its own generation on refresh', async () => {
    const slots = withOfficial(new FakeSlots())
    slots.failOn = 'conversation.hero.workspace'
    const controller = new ClientActivationController({
      clientId: 'tab-1', slots, contributions: contributions('tab-1'),
      isHostReady: () => true, prepare: async () => {},
    })
    expect(await controller.activate()).toMatchObject({ state: 'CLIENT_FALLBACK' })
    expect(slots.entries.every(entry => entry.registrant === 'official')).toBe(true)

    slots.failOn = undefined
    expect(await controller.refresh()).toEqual({ state: 'CLIENT_FEDERATED' })
    const firstGeneration = controller.generation
    expect(await controller.refresh()).toEqual({ state: 'CLIENT_FEDERATED' })
    expect(controller.generation).toBe(firstGeneration + 1)
    expect(slots.entries.filter(entry => entry.registrant.startsWith('federation:')).length).toBe(2)
    controller.dispose()
    expect(slots.entries.every(entry => entry.registrant === 'official')).toBe(true)
  })
})
