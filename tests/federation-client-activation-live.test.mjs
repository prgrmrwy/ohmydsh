import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Per-client activation against the REAL rc.2 SlotCore.
 *
 * The package's own unit test drives `ClientActivationController` through a
 * hand-written `FakeSlots`, and the real `SlotCore` is otherwise only exercised
 * by the throwaway `scripts/federation-activation-prototype.mjs`. This test
 * closes that gap: the shipped class must satisfy the real registry's priority,
 * collision, abdication and disposer semantics.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

const OfficialSidebar = () => null
const OfficialPicker = () => null

/** A SlotCore pre-seeded with the official entries federation must shadow. */
function officialSlots() {
  const slots = new SlotCore()
  // Real SlotCore requires a parent entry to declare the holes first, exactly
  // as the official shell does.
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

/**
 * Adapts the real SlotCore to the package's minimal `SlotHandle` seam. Only
 * shape adaptation happens here — every semantic decision stays in SlotCore.
 */
function handleFor(slots) {
  return {
    register: (descriptor, component) => slots.register(descriptor, component),
    onEntryError: listener => slots.onEntryError((slotName, entry, error, info) =>
      listener(slotName, entry.component, error, { abdicated: info.abdicated ?? info.abdicate === true })),
  }
}

const winner = (slots, name) => slots.entriesOfSlot(name)[0]?.component

async function loadController() {
  const bundle = path.join(REPO, 'node_modules/.cache', `federation-client-activation-${process.pid}.mjs`)
  const built = spawnSync(path.join(REPO, 'node_modules/.bin/esbuild'), [
    path.join(PKG, 'src/client/activation.ts'), '--bundle', '--format=esm', '--platform=node',
    `--outfile=${bundle}`, '--log-level=error',
  ], { encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)
  const mod = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)
  return { ClientActivationController: mod.ClientActivationController, bundle }
}

test('the shipped client activation controller satisfies real rc.2 SlotCore semantics', { timeout: 120_000 }, async () => {
  const { ClientActivationController, bundle } = await loadController()
  try {
    // 1) Federation shadows both official entries at a lower priority number.
    const slots = officialSlots()
    const FederationSidebar = () => null
    const FederationPicker = () => null
    const controller = new ClientActivationController({
      clientId: 'tab-1',
      slots: handleFor(slots),
      contributions: [
        { slot: 'sidebar.workspaces', priority: -1, component: FederationSidebar },
        { slot: 'conversation.hero.workspace', priority: -1, component: FederationPicker },
      ],
      isHostReady: () => true,
      prepare: async () => {},
    })
    assert.equal(winner(slots, 'sidebar.workspaces'), OfficialSidebar)
    assert.deepEqual(await controller.activate(), { state: 'CLIENT_FEDERATED' })
    assert.equal(winner(slots, 'sidebar.workspaces'), FederationSidebar)
    assert.equal(winner(slots, 'conversation.hero.workspace'), FederationPicker)

    // 2) A real SlotCore priority collision must roll the whole client back:
    //    no half-shadowed sidebar, official stays the winner everywhere.
    const collided = officialSlots()
    collided.register({ name: 'conversation.hero.workspace', priority: -1, registrant: 'other-plugin' }, () => null)
    const rollback = new ClientActivationController({
      clientId: 'tab-collide',
      slots: handleFor(collided),
      contributions: [
        { slot: 'sidebar.workspaces', priority: -1, component: () => null },
        { slot: 'conversation.hero.workspace', priority: -1, component: () => null },
      ],
      isHostReady: () => true,
      prepare: async () => {},
    })
    const outcome = await rollback.activate()
    assert.equal(outcome.state, 'CLIENT_FALLBACK', JSON.stringify(outcome))
    assert.match(String(outcome.diagnostic), /already has a registration/)
    assert.equal(winner(collided, 'sidebar.workspaces'), OfficialSidebar,
      'a partial registration must be rolled back, not left shadowing')

    // 3) Real abdication: SlotCore keeps the entry but demotes it, and the
    //    controller must dispose BOTH federation surfaces for this client.
    const crashing = officialSlots()
    const CrashSidebar = () => null
    const CrashPicker = () => null
    const crashController = new ClientActivationController({
      clientId: 'tab-crash',
      slots: handleFor(crashing),
      contributions: [
        { slot: 'sidebar.workspaces', priority: -1, component: CrashSidebar },
        { slot: 'conversation.hero.workspace', priority: -1, component: CrashPicker },
      ],
      isHostReady: () => true,
      prepare: async () => {},
    })
    await crashController.activate()
    assert.equal(winner(crashing, 'sidebar.workspaces'), CrashSidebar)
    const entry = crashing.entriesOfSlot('sidebar.workspaces')[0]
    crashing.reportEntryError('sidebar.workspaces', entry, new Error('render failed'), { abdicate: true })
    assert.equal(crashController.state, 'CLIENT_FALLBACK')
    assert.equal(winner(crashing, 'sidebar.workspaces'), OfficialSidebar)
    assert.equal(winner(crashing, 'conversation.hero.workspace'), OfficialPicker,
      'the sibling federation surface must be disposed too')

    // 4) Two independent clients: one crashing must not affect the other.
    const slotsA = officialSlots()
    const slotsB = officialSlots()
    const SidebarA = () => null
    const SidebarB = () => null
    const clientA = new ClientActivationController({
      clientId: 'tab-a', slots: handleFor(slotsA),
      contributions: [{ slot: 'sidebar.workspaces', priority: -1, component: SidebarA }],
      isHostReady: () => true, prepare: async () => {},
    })
    const clientB = new ClientActivationController({
      clientId: 'tab-b', slots: handleFor(slotsB),
      contributions: [{ slot: 'sidebar.workspaces', priority: -1, component: SidebarB }],
      isHostReady: () => true, prepare: async () => {},
    })
    await clientA.activate()
    await clientB.activate()
    const entryA = slotsA.entriesOfSlot('sidebar.workspaces')[0]
    slotsA.reportEntryError('sidebar.workspaces', entryA, new Error('boom'), { abdicate: true })
    assert.equal(clientA.state, 'CLIENT_FALLBACK')
    assert.equal(clientB.state, 'CLIENT_FEDERATED')
    assert.equal(winner(slotsA, 'sidebar.workspaces'), OfficialSidebar)
    assert.equal(winner(slotsB, 'sidebar.workspaces'), SidebarB,
      'a crash in one browser must not demote another browser')

    // 5) Refresh replaces only this client's generation; the real registry ends
    //    up with exactly one federation entry per slot, not an accumulation.
    const refreshed = officialSlots()
    const refreshController = new ClientActivationController({
      clientId: 'tab-refresh', slots: handleFor(refreshed),
      contributions: [{ slot: 'sidebar.workspaces', priority: -1, component: () => null }],
      isHostReady: () => true, prepare: async () => {},
    })
    await refreshController.activate()
    const firstGeneration = refreshController.generation
    assert.deepEqual(await refreshController.refresh(), { state: 'CLIENT_FEDERATED' })
    assert.equal(refreshController.generation, firstGeneration + 1)
    // entriesOfSlot() yields the single winner; entries() yields every
    // registration — a refresh must not accumulate federation entries.
    assert.equal(refreshed.entries('sidebar.workspaces').length, 2,
      'exactly one federation entry plus the official entry must remain')

    // 6) Disposing returns the real registry to the official winner.
    refreshController.dispose()
    assert.equal(winner(refreshed, 'sidebar.workspaces'), OfficialSidebar)
    assert.equal(refreshed.entries('sidebar.workspaces').length, 1)
  } finally {
    await rm(bundle, { force: true })
  }
})
