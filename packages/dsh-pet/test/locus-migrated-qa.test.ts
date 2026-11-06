/**
 * Spec: pet-locus-collaboration 旧数据经 v20 离线迁移清除并整形 →
 * "归并后默认 Q&A 可发现且不外部建群" (controller half; the persistence half is
 * in migrate-cli-v20.test.ts). Real migration script, real v20 repository, real
 * controller; only the Host/Lark/collab ports are fakes.
 */
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { LocusController } from '../src/host/locus/controller.js'
import { LocusRepositoryV20 } from '../src/host/locus/persistence-v20.js'
import { openMigratedDomain } from './support/pet-domain-open.js'
import { tempPetHome } from './support/pet-sqlite.js'
import { seedV19State, v19DefaultQa, v19Main, v19Row, type V19Rows } from './support/v19-seed.js'
import { Topology } from './support/w-topology.js'

const SCRIPT = new URL('../scripts/migrate-state-version.mjs', import.meta.url).pathname

/** Same W, unique active M1; the default Q&A group and its topics still on retired M0. */
function crossPairingRows(): V19Rows {
  return {
    locus_mains: {
      M0: v19Main({ id: 'M0', work: 'W', status: 'retired', generation: 1 }),
      M1: v19Main({ id: 'M1', work: 'W', generation: 2 }),
    },
    loci: {
      'g-oc_g': v19Row({ id: 'g-oc_g', chatId: 'oc_g', main: 'M1', revision: 4 }),
      'g-oc_q': v19Row({ id: 'g-oc_q', chatId: 'oc_q', main: 'M0', source: 'qa-created', revision: 2 }),
      qt: v19Row({ id: 'qt', chatId: 'oc_q', threadId: 'omt_qt', main: 'M0', revision: 1 }),
      qs: v19Row({ id: 'qs', chatId: 'oc_q', threadId: 'omt_qs', main: 'M0', state: 'stopped', child: 'child-qs', stoppedAt: 9, revision: 6 }),
    },
    locus_indexes: { 'default-qa:M0': v19DefaultQa('M0', 'g-oc_q') },
  }
}

async function migrate() {
  const { file } = tempPetHome('pet-migrated-qa-')
  await seedV19State(file, 19, crossPairingRows())
  const result = spawnSync(process.execPath, [SCRIPT, '--db', file, '--yes'], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return file
}

/** One Host "lifetime": open the migrated medium and build a controller over it. */
async function host(file: string) {
  const opened = await openMigratedDomain(file)
  const repository = new LocusRepositoryV20(opened.domain as ConstructorParameters<typeof LocusRepositoryV20>[0])
  const t = new Topology()
  t.addSession({ id: 'W', workspaceId: 'proj', title: 'W' })
  t.addSession({ id: 'M1', workspaceId: 'pet-ws', title: 'M1', agentPreset: 'locus-base' })
  const groupCreations: string[] = []
  const deps = t.deps()
  const controller = new LocusController({
    ...deps,
    repository,
    lark: { ...deps.lark!, createGroup: async input => { groupCreations.push(input.name); return deps.lark!.createGroup(input) } },
  })
  return { opened, repository, t, controller, groupCreations }
}

describe('归并后默认 Q&A 可发现且不外部建群', () => {
  it.each(['first open', 'after a Host restart'])('%s: the original Q is returned, nothing external is created', async phase => {
    const file = await migrate()
    for (let lifetime = 0; lifetime < (phase === 'first open' ? 1 : 2); lifetime += 1) {
      const h = await host(file)
      try {
        const qa = await h.controller.createOrOpenDefaultQa({ parentSessionId: 'W', ownerId: 'ou_owner' })
        expect(qa).toMatchObject({ created: false, reused: true })
        expect(qa.group.endpoint).toEqual({ chatId: 'oc_q' })
        expect(qa.group.locusId).toBe('g-oc_q')
        expect(h.groupCreations).toEqual([])
        expect(h.t.created).toEqual([])
        expect(h.t.spacesEstablished).toEqual([])
      } finally { await h.opened.close() }
    }
  })

  it('an authorized @ in Q and in G triggers no new M, no external creation and no pairing conflict', async () => {
    const file = await migrate()
    for (let lifetime = 0; lifetime < 2; lifetime += 1) {
      const h = await host(file)
      try {
        for (const chatId of ['oc_q', 'oc_g']) {
          const entry = await h.controller.ensureEntry({ chatId })
          expect(entry.created, chatId).toBe(false)
          expect(entry.migration, chatId).toBeUndefined()
          const group = entry.group!
          expect(group.locusMainSessionId).toBe('M1')
        }
        expect(h.t.created).toEqual([])
        expect(h.t.spacesEstablished).toEqual([])
        expect(h.groupCreations).toEqual([])
        expect(h.repository.listPairingsOfWork('W').filter(p => p.status === 'active')).toHaveLength(1)
      } finally { await h.opened.close() }
    }
  })
})
