import test from 'node:test'
import assert from 'node:assert/strict'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ClientActivationPrototype,
  ClientActivationState,
  HostActivationPrototype,
  HostActivationState,
  createClientGenerationTracker,
} from '../scripts/federation-activation-prototype.mjs'

const OfficialSidebar = () => null
const OfficialPicker = () => null
const FederationSidebar = () => null
const FederationPicker = () => null

function clientSlots() {
  const slots = new SlotCore()
  slots.register({
    name: 'root',
    children: {
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
    },
    registrant: 'official-shell',
  }, () => null)
  slots.register({ name: 'sidebar.workspaces', registrant: 'official-workspace' }, OfficialSidebar)
  slots.register({ name: 'conversation.hero.workspace', registrant: 'official-workspace' }, OfficialPicker)
  return slots
}

function contributions() {
  return [
    { slot: 'sidebar.workspaces', priority: -1, component: FederationSidebar },
    { slot: 'conversation.hero.workspace', priority: -1, component: FederationPicker },
  ]
}

const winners = slots => ({
  sidebar: slots.entriesOfSlot('sidebar.workspaces')[0]?.component,
  picker: slots.entriesOfSlot('conversation.hero.workspace')[0]?.component,
})

test('host activation commits READY once and rolls back reverse on conflicts', async () => {
  const host = new HostActivationPrototype()
  const disposed = []
  await host.activate({
    prepare: async () => {},
    registrations: ['middleware', 'history', 'export'].map(label => async () => async () => { disposed.push(label) }),
  })
  assert.equal(host.state, HostActivationState.READY)
  assert.equal(host.applyCount, 1)
  await host.activate({ prepare: async () => { throw new Error('must not reapply') }, registrations: [] })
  assert.equal(host.applyCount, 1)
  await host.stop()
  assert.equal(host.state, HostActivationState.DISABLED)
  assert.deepEqual(disposed, ['export', 'history', 'middleware'])

  const conflict = new HostActivationPrototype()
  await conflict.activate({
    prepare: async () => {},
    registrations: [
      async () => async () => { disposed.push('first') },
      async () => { const error = new Error('occupied'); error.code = 'ROUTE_CONFLICT'; throw error },
    ],
  })
  assert.equal(conflict.state, HostActivationState.CONFLICT)
  assert.equal(disposed.at(-1), 'first')
})

test('two tabs and a late tab activate independently against one READY Host', async () => {
  const host = new HostActivationPrototype()
  await host.activate({ prepare: async () => {}, registrations: [] })
  const nextGeneration = createClientGenerationTracker()
  const make = id => new ClientActivationPrototype({
    clientId: id, generation: nextGeneration(id), host, slots: clientSlots(), contributions: contributions(),
  })
  const a = make('tab-a')
  const b = make('tab-b')
  await Promise.all([a.activate(async () => {}), b.activate(async () => {})])
  assert.equal(a.state, ClientActivationState.FEDERATED)
  assert.equal(b.state, ClientActivationState.FEDERATED)
  assert.deepEqual(winners(a.slots), { sidebar: FederationSidebar, picker: FederationPicker })
  assert.deepEqual(winners(b.slots), { sidebar: FederationSidebar, picker: FederationPicker })

  const late = make('tab-c')
  await late.activate(async () => {})
  assert.equal(late.state, ClientActivationState.FEDERATED)
  assert.equal(host.applyCount, 1)
})

test('refresh replaces only that client generation without Host reapply', async () => {
  const host = new HostActivationPrototype()
  await host.activate({ prepare: async () => {}, registrations: [] })
  const nextGeneration = createClientGenerationTracker()
  const firstSlots = clientSlots()
  const first = new ClientActivationPrototype({ clientId: 'tab-a', generation: nextGeneration('tab-a'), host, slots: firstSlots, contributions: contributions() })
  await first.activate(async () => {})
  assert.equal(first.generation, 1)
  first.dispose()
  assert.deepEqual(winners(firstSlots), { sidebar: OfficialSidebar, picker: OfficialPicker })

  const refreshed = new ClientActivationPrototype({ clientId: 'tab-a', generation: nextGeneration('tab-a'), host, slots: clientSlots(), contributions: contributions() })
  await refreshed.activate(async () => {})
  assert.equal(refreshed.generation, 2)
  assert.equal(refreshed.state, ClientActivationState.FEDERATED)
  assert.equal(host.applyCount, 1)
})

test('one client readiness failure falls back to official while another stays federated', async () => {
  const host = new HostActivationPrototype()
  await host.activate({ prepare: async () => {}, registrations: [] })
  const healthy = new ClientActivationPrototype({ clientId: 'healthy', generation: 1, host, slots: clientSlots(), contributions: contributions() })
  const failed = new ClientActivationPrototype({ clientId: 'failed', generation: 1, host, slots: clientSlots(), contributions: contributions() })
  await healthy.activate(async () => {})
  await failed.activate(async () => { throw new Error('embed unavailable') })
  assert.equal(healthy.state, ClientActivationState.FEDERATED)
  assert.equal(failed.state, ClientActivationState.FALLBACK)
  assert.deepEqual(winners(healthy.slots), { sidebar: FederationSidebar, picker: FederationPicker })
  assert.deepEqual(winners(failed.slots), { sidebar: OfficialSidebar, picker: OfficialPicker })
  assert.equal(host.state, HostActivationState.READY)
})

test('entry crash abdicates and disposes both federation surfaces only in the crashing client', async () => {
  const host = new HostActivationPrototype()
  await host.activate({ prepare: async () => {}, registrations: [] })
  const a = new ClientActivationPrototype({ clientId: 'a', generation: 1, host, slots: clientSlots(), contributions: contributions() })
  const b = new ClientActivationPrototype({ clientId: 'b', generation: 1, host, slots: clientSlots(), contributions: contributions() })
  await a.activate(async () => {})
  await b.activate(async () => {})

  const crashed = a.slots.entriesOfSlot('sidebar.workspaces')[0]
  a.slots.reportEntryError('sidebar.workspaces', crashed, new Error('render boom'), { abdicate: true })
  assert.equal(a.state, ClientActivationState.FALLBACK)
  assert.deepEqual(winners(a.slots), { sidebar: OfficialSidebar, picker: OfficialPicker })
  assert.equal(b.state, ClientActivationState.FEDERATED)
  assert.deepEqual(winners(b.slots), { sidebar: FederationSidebar, picker: FederationPicker })
  assert.equal(host.state, HostActivationState.READY)
})

test('SlotCore priority, collision, disposer and abdication match rc.2 semantics', () => {
  const slots = clientSlots()
  const dispose = slots.register({ name: 'sidebar.workspaces', priority: -1, registrant: 'federation' }, FederationSidebar)
  assert.equal(slots.entriesOfSlot('sidebar.workspaces')[0].component, FederationSidebar)
  assert.throws(
    () => slots.register({ name: 'sidebar.workspaces', priority: -1, registrant: 'collision' }, () => null),
    /already has a registration.*priority -1/,
  )
  const entry = slots.entriesOfSlot('sidebar.workspaces')[0]
  slots.reportEntryError('sidebar.workspaces', entry, new Error('boom'), { abdicate: true })
  assert.equal(slots.entries('sidebar.workspaces').includes(entry), true)
  assert.equal(slots.entriesOfSlot('sidebar.workspaces')[0].component, OfficialSidebar)
  dispose()
  dispose()
  assert.equal(slots.entries('sidebar.workspaces').length, 1)
})
