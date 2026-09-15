/**
 * Behaviour tests for the locus presentation model.
 *
 * These assert real snapshots — a topic, a rebuilt entry, an archived parent, a
 * generation whose parent session changed — rather than the presence of strings
 * in a source file. That is the point of extracting `locus-view.ts`: the old
 * surface could only prove it contained certain text, never that it grouped the
 * right locus under the right session.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCUS_FILTER,
  ENTRY_STATE_OPTIONS,
  LOCUS_STATE_LABELS,
  PARENT_AVAILABILITY_LABELS,
  applyLocusFilter,
  assignHandleCodes,
  collectHandleCodes,
  entryMatchesQuery,
  endpointKey,
  entryDisplayName,
  familyHead,
  groupByEntry,
  groupByWork,
  handleCode,
  isHostCurrent,
  locusSourceLabel,
  locusStateLabel,
  locusStateTone,
  parentAvailabilityOf,
  summarizeLocusView,
  endpointHandleLabel,
  handleLabel
} from '../src/client/locus-view.js'
import type {
  PetLocusManagementView,
  PetLocusSource,
  PetLocusState,
  PetLocusView,
} from '../src/wire.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface LocusInput {
  readonly locusId: string
  readonly generation?: number
  readonly chatId: string
  readonly threadId?: string
  readonly chatName?: string
  readonly parentSessionId: string
  readonly parentTitle?: string
  readonly parentAvailability?: 'available' | 'archived' | 'missing'
  readonly childSessionId?: string
  readonly childTitle?: string
  readonly childAvailability?: 'available' | 'archived' | 'missing'
  readonly workspaceId?: string
  readonly workspaceTitle?: string
  readonly state?: PetLocusState
  readonly source?: PetLocusSource
  readonly parentLocusId?: string
  readonly isDefaultQa?: boolean
}

function locus(input: LocusInput): PetLocusView {
  const source: PetLocusSource = input.source ?? 'auto'
  return {
    locusId: input.locusId,
    generation: input.generation ?? 1,
    endpoint: {
      chatId: input.chatId,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      ...(input.chatName === undefined ? {} : { chatName: input.chatName }),
    },
    main: {
      sessionId: input.parentSessionId,
      source,
      ...(input.parentTitle === undefined ? {} : { title: input.parentTitle }),
      ...(input.parentAvailability === undefined ? {} : { availability: input.parentAvailability }),
    },
    child: {
      ...(input.childSessionId === undefined ? {} : { sessionId: input.childSessionId }),
      ...(input.childTitle === undefined ? {} : { title: input.childTitle }),
      ...(input.childAvailability === undefined ? {} : { availability: input.childAvailability }),
    },
    workspace: {
      workspaceId: input.workspaceId ?? 'ws-1',
      ...(input.workspaceTitle === undefined ? {} : { title: input.workspaceTitle }),
    },
    permission: { desired: 'read', effective: 'read' },
    state: {
      state: input.state ?? 'active',
      busy: false,
      createdAt: 1,
      updatedAt: 2,
    },
    source,
    ...(input.parentLocusId === undefined ? {} : { parentLocusId: input.parentLocusId }),
    isDefaultQa: input.isDefaultQa ?? false,
  }
}

/**
 * Build a snapshot the way the Host does: indexes are derived from the same
 * record set, and the current generation is stated explicitly — this module is
 * forbidden from inventing one.
 */
function snapshot(loci: readonly PetLocusView[], currents: readonly string[] = []): PetLocusManagementView {
  const byEndpointKey = new Map<string, PetLocusView[]>()
  for (const record of loci) {
    const key = endpointKey(record.endpoint)
    const list = byEndpointKey.get(key)
    if (list === undefined) byEndpointKey.set(key, [record])
    else list.push(record)
  }
  const currentIds = new Set(currents)
  const byEndpoint = [...byEndpointKey.entries()].map(([, records]) => {
    const sorted = [...records].sort((left, right) => left.generation - right.generation)
    const current = sorted.find(record => currentIds.has(record.locusId))
    const first = sorted[0]
    if (first === undefined) throw new Error('fixture: empty endpoint history')
    return {
      endpoint: first.endpoint,
      ...(current === undefined ? {} : { current }),
      history: sorted,
    }
  })

  const parentIds = [...new Set(loci.map(record => record.main.sessionId))]
  const byParent = parentIds.map(parentSessionId => {
    const members = loci.filter(record => record.main.sessionId === parentSessionId)
    const defaultQa = members.find(record => record.isDefaultQa)
    return {
      parentSessionId,
      ...(defaultQa === undefined ? {} : { defaultQa }),
      loci: members,
    }
  })

  const childIds = [...new Set(loci.flatMap(record => (record.child.sessionId === undefined ? [] : [record.child.sessionId])))]
  const byChild = childIds.map(childSessionId => {
    const match = loci.find(record => record.child.sessionId === childSessionId)
    return {
      childSessionId,
      ...(match === undefined ? {} : { locus: match }),
      history: loci.filter(record => record.child.sessionId === childSessionId),
    }
  })

  const defaultQa = loci
    .filter(record => record.isDefaultQa)
    .map(record => ({ parentSessionId: record.main.sessionId, locus: record }))

  return { generation: 1, loci, defaultQa, discovery: { byEndpoint, byParent, byChild } }
}

/** The realistic shape: one chat entry, one topic inheriting it, one rebuild. */
function realisticSnapshot(): PetLocusManagementView {
  const chat = locus({
    locusId: 'locus-runtime-1789395333907-19064d8aca8a48',
    chatId: 'oc_591324b60afa1d62f3e229104607c586',
    parentSessionId: 'session-4629eb39-c996-4ff6-ad0e-b59ac54337a1',
    parentTitle: '未命名会话',
    parentAvailability: 'archived',
    childSessionId: 'session-7b41abe2-f878-4d5c-9cf0-a6b548219c1a',
    workspaceTitle: 'nexus',
  })
  const chatGen2 = locus({
    locusId: 'locus-runtime-1789395333907-19064d8aca8a48-g2',
    generation: 2,
    chatId: 'oc_591324b60afa1d62f3e229104607c586',
    parentSessionId: 'session-4629eb39-c996-4ff6-ad0e-b59ac54337a1',
    parentTitle: '未命名会话',
    parentAvailability: 'archived',
    childSessionId: 'session-7b41abe2-f878-4d5c-9cf0-a6b548219c1a',
    workspaceTitle: 'nexus',
  })
  const topic = locus({
    locusId: 'locus-runtime-1789397609276-f750f727f1988',
    chatId: 'oc_591324b60afa1d62f3e229104607c586',
    threadId: 'omt_19cd829b840f5bee',
    parentSessionId: 'session-4629eb39-c996-4ff6-ad0e-b59ac54337a1',
    parentTitle: '未命名会话',
    parentAvailability: 'archived',
    childSessionId: 'session-19b894b4-49d9-4417-a0f1-e194f0baad6f',
    source: 'inherited',
    parentLocusId: chatGen2.locusId,
    workspaceTitle: 'nexus',
  })
  const qa = locus({
    locusId: 'locus-runtime-1789398952986-b0d570a7406468',
    chatId: 'oc_b1fa0f02b695fbf4bd4ff2ebb322fad4',
    chatName: '答疑 · DSH',
    parentSessionId: 'session-906220d3-ecee-41d0-9320-f425f17edefe',
    parentTitle: 'pet locus 待办依赖与优先级',
    parentAvailability: 'available',
    childSessionId: 'session-a380ee7b-8b44-406f-80dd-2f1c92023701',
    childTitle: '答疑 · DSH',
    source: 'qa-created',
    isDefaultQa: true,
    workspaceTitle: 'ohmydsh',
  })
  return snapshot([chat, chatGen2, topic, qa], [chatGen2.locusId, qa.locusId])
}

// ---------------------------------------------------------------------------
// 1.1 Short codes
// ---------------------------------------------------------------------------

describe('short codes', () => {
  it('follows one documented rule per kind', () => {
    expect(handleCode('oc_a27b5de7e6a9a57462060eb289ec70ab', 'endpoint')).toBe('a27b')
    expect(handleCode('omt_19cd829b840f5bee', 'endpoint')).toBe('19cd')
    expect(handleCode('session-906220d3-ecee-41d0-9320-f425f17edefe', 'session')).toBe('9062')
    // The timestamp segment of a locus id has no discriminating power, so the
    // code comes from the trailing segment instead.
    expect(handleCode('locus-runtime-1789394541339-2f853e76111d38', 'locus')).toBe('2f85')
    expect(handleCode('d5d2ebd5-7296-42c9-a34a-16753deb417b', 'workspace')).toBe('d5d2')
  })

  it('carries the object type into the label the surface shows', () => {
    // Six bare fragments in one row are indistinguishable; the prefix is what
    // makes a session code readable next to a locus code.
    expect(handleLabel('locus', '2f85')).toBe('L·2f85')
    expect(handleLabel('session', '9062')).toBe('S·9062')
    expect(handleLabel('workspace', 'd5d2')).toBe('W·d5d2')
    expect(endpointHandleLabel({ chatId: 'oc_a' }, 'a27b')).toBe('oc·a27b')
    expect(endpointHandleLabel({ chatId: 'oc_a', threadId: 'omt_1' }, '19cd')).toBe('omt·19cd')
    expect(handleLabel('session', '')).toBe('')
  })

  it('returns nothing for a blank id rather than a bogus code', () => {
    expect(handleCode('   ', 'session')).toBe('')
  })

  it('lengthens only the colliding codes, and only as far as needed', () => {
    const ids = ['session-906220d3-aaaa', 'session-90622111-bbbb', 'session-ffffffff-cccc']
    const codes = assignHandleCodes(ids, 'session')
    // The first two share '9062', so both grow to six characters; the third is
    // already unique and keeps the shortest code.
    expect(codes.get(ids[0])).toBe('906220')
    expect(codes.get(ids[1])).toBe('906221')
    expect(codes.get(ids[2])).toBe('ffff')
  })

  it('never lets two rows share an alias when only the full id differs', () => {
    // Same uuid prefix, differing only in a later group: no length of the
    // distinguishing substring can separate them, so the alias falls back to the
    // whole identifier rather than collapsing two rows into one label.
    const ids = ['session-906220d3-aaaa', 'session-906220d3-bbbb']
    const codes = assignHandleCodes(ids, 'session')
    expect(codes.get(ids[0])).toBe(ids[0])
    expect(codes.get(ids[1])).toBe(ids[1])
    expect(new Set(codes.values()).size).toBe(2)
  })

  it('keeps the shortest code when there is no collision', () => {
    const codes = assignHandleCodes(['session-12345678-a', 'session-abcdef12-b'], 'session')
    expect(codes.get('session-12345678-a')).toBe('1234')
  })
})

// ---------------------------------------------------------------------------
// 1.2 Family aggregation
// ---------------------------------------------------------------------------

describe('one row per entry', () => {
  it('collapses every generation of an endpoint into one family', () => {
    const works = groupByWork(realisticSnapshot())
    const nexus = works.find(work => work.parentSessionId === 'session-4629eb39-c996-4ff6-ad0e-b59ac54337a1')
    expect(nexus?.families).toHaveLength(2)
    const chatFamily = nexus?.families.find(family => family.endpoint.threadId === undefined)
    expect(chatFamily?.generations).toHaveLength(2)
    expect(chatFamily?.history).toHaveLength(1)
    expect(chatFamily?.history[0]?.generation).toBe(1)
  })

  it('takes current-ness from the Host index, not from the newest generation', () => {
    const older = locus({ locusId: 'locus-runtime-1-aaaa1111', chatId: 'oc_a', parentSessionId: 'session-1' })
    const newer = locus({ locusId: 'locus-runtime-2-bbbb2222', generation: 2, chatId: 'oc_a', parentSessionId: 'session-1' })
    // The Host index names the OLDER generation: a stopped/invalid marker is
    // still the authoritative current row, and reviving a newer one would be a
    // routing claim this surface has no business making.
    const families = groupByWork(snapshot([older, newer], [older.locusId]))[0]?.families
    const family = families?.[0]
    expect(family?.current?.locusId).toBe(older.locusId)
    expect(isHostCurrent(family!, older)).toBe(true)
    expect(isHostCurrent(family!, newer)).toBe(false)
  })

  it('claims no current generation when the index is silent', () => {
    const only = locus({ locusId: 'locus-runtime-1-aaaa1111', chatId: 'oc_a', parentSessionId: 'session-1' })
    const family = groupByWork(snapshot([only]))[0]?.families[0]
    expect(family?.current).toBeUndefined()
    expect(isHostCurrent(family!, only)).toBe(false)
    // A display head still exists so the row renders; the row simply carries no
    // 「当前代」 marker.
    expect(familyHead(family!)?.locusId).toBe(only.locusId)
  })

  it('keeps one entry under the current generation when the source session changed', () => {
    const gen1 = locus({ locusId: 'locus-runtime-1-aaaa1111', chatId: 'oc_a', parentSessionId: 'session-A' })
    const gen2 = locus({ locusId: 'locus-runtime-2-bbbb2222', generation: 2, chatId: 'oc_a', parentSessionId: 'session-B' })
    const works = groupByWork(snapshot([gen1, gen2], [gen2.locusId]))
    const workB = works.find(work => work.parentSessionId === 'session-B')
    expect(workB?.families).toHaveLength(1)
    // The older generation is history, not a second row under its old session.
    expect(workB?.families[0]?.history.map(item => item.locusId)).toEqual([gen1.locusId])
  })
})

// ---------------------------------------------------------------------------
// 1.3 Two readings
// ---------------------------------------------------------------------------

describe('readings', () => {
  it('nests a topic under the chat entry it inherits from', () => {
    const works = groupByWork(realisticSnapshot())
    const nexus = works.find(work => work.parentSessionId === 'session-4629eb39-c996-4ff6-ad0e-b59ac54337a1')
    expect(nexus?.nodes).toHaveLength(1)
    expect(nexus?.nodes[0]?.family.endpoint.threadId).toBeUndefined()
    expect(nexus?.nodes[0]?.children).toHaveLength(1)
    expect(nexus?.nodes[0]?.children[0]?.family.endpoint.threadId).toBe('omt_19cd829b840f5bee')
  })

  it('does not nest a topic under a parent that lives in another work group', () => {
    const chat = locus({ locusId: 'locus-runtime-1-aaaa1111', chatId: 'oc_a', parentSessionId: 'session-A' })
    const foreignTopic = locus({
      locusId: 'locus-runtime-2-bbbb2222',
      chatId: 'oc_a',
      threadId: 'omt_1',
      parentSessionId: 'session-B',
      parentLocusId: chat.locusId,
    })
    const works = groupByWork(snapshot([chat, foreignTopic]))
    const workB = works.find(work => work.parentSessionId === 'session-B')
    // Root, not a child: putting it under session A's tree would file a row
    // under a session it does not belong to.
    expect(workB?.nodes).toHaveLength(1)
    expect(workB?.nodes[0]?.children).toHaveLength(0)
  })

  it('groups the reverse reading by chat with its topics', () => {
    const entries = groupByEntry(realisticSnapshot())
    expect(entries).toHaveLength(2)
    const chatGroup = entries.find(group => group.chatId === 'oc_591324b60afa1d62f3e229104607c586')
    expect(chatGroup?.chatFamily?.endpoint.threadId).toBeUndefined()
    expect(chatGroup?.topicFamilies).toHaveLength(1)
    expect(chatGroup?.families).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 1.4 Names
// ---------------------------------------------------------------------------

describe('names', () => {
  it('never calls an untyped chat a group', () => {
    const endpoint = { chatId: 'oc_a27b5de7e6a9a57462060eb289ec70ab' }
    const display = entryDisplayName(endpoint, 'a27b')
    expect(display.name).toBe('入口 · a27b')
    expect(display.isPlaceholder).toBe(true)
    expect(display.role.label).toBe('入口')
  })

  it('uses a topic role for a thread endpoint', () => {
    const display = entryDisplayName({ chatId: 'oc_a', threadId: 'omt_19cd829b840f5bee' }, '19cd')
    expect(display.name).toBe('话题 · 19cd')
    expect(display.role.isTopic).toBe(true)
  })

  it('prefers a provided name and marks it as real', () => {
    const display = entryDisplayName({ chatId: 'oc_a', chatName: '答疑 · DSH' }, 'a27b')
    expect(display.name).toBe('答疑 · DSH')
    expect(display.isPlaceholder).toBe(false)
  })

  it('falls back to the raw id only when no code could be derived', () => {
    expect(entryDisplayName({ chatId: 'oc_a' }, '').name).toBe('入口 · oc_a')
  })
})

// ---------------------------------------------------------------------------
// 1.7 State vocabulary
// ---------------------------------------------------------------------------

describe('state vocabulary', () => {
  const states: readonly PetLocusState[] = ['provisioning', 'active', 'switching', 'invalid', 'stopped', 'retired']

  it('covers all six lifecycle states', () => {
    expect(Object.keys(LOCUS_STATE_LABELS).sort()).toEqual([...states].sort())
    for (const state of states) {
      expect(locusStateLabel(state)).not.toBe('')
      expect(locusStateLabel(state)).not.toBe('未知状态')
      expect(['on', 'warn', 'off', 'gone']).toContain(locusStateTone(state))
    }
  })

  it('names provisioning explicitly instead of leaving it blank', () => {
    expect(locusStateLabel('provisioning')).toBe('准备中')
    expect(locusStateTone('provisioning')).toBe('warn')
  })

  it('degrades an unrecognised state to a visible word', () => {
    expect(locusStateLabel('something-new')).toBe('未知状态')
  })

  it('separates the creation action from being the default entry', () => {
    // `qa-created` records which action built the association; whether it is the
    // session's default entry is `isDefaultQa`. Labelling the former as
    // 「默认 Q&A」 mislabelled every non-default Q&A locus.
    expect(locusSourceLabel('qa-created')).toBe('答疑群建立')
  })
})

// ---------------------------------------------------------------------------
// 1.5 / 1.8 Filtering
// ---------------------------------------------------------------------------

describe('filtering', () => {
  it('buckets every entry state exactly once', () => {
    const covered = ENTRY_STATE_OPTIONS.flatMap(option => option.states)
    expect([...covered].sort()).toEqual(
      ['active', 'invalid', 'provisioning', 'retired', 'stopped', 'switching'].sort(),
    )
    expect(new Set(covered).size).toBe(covered.length)
  })

  it('maps session availability into three buckets', () => {
    expect(parentAvailabilityOf({ sessionId: 's', availability: 'available' })).toBe('available')
    expect(parentAvailabilityOf({ sessionId: 's', availability: 'archived' })).toBe('archived')
    expect(parentAvailabilityOf({ sessionId: 's', availability: 'missing' })).toBe('unverified')
    expect(parentAvailabilityOf({ sessionId: 's' })).toBe('unverified')
    expect(Object.keys(PARENT_AVAILABILITY_LABELS).sort()).toEqual(['archived', 'available', 'unverified'])
  })

  it('hides archived work by default and reports what it hid', () => {
    const view = applyLocusFilter(realisticSnapshot())
    expect(view.works).toHaveLength(1)
    expect(view.works[0]?.parentSessionId).toBe('session-906220d3-ecee-41d0-9320-f425f17edefe')
    expect(view.hidden.parentSessions).toBe(1)
    expect(view.hidden.entries).toBe(2)
    expect(view.hidden.parentReasons[0]?.label).toBe('已归档')
  })

  it('never hides silently when the entry-state filter is narrowed', () => {
    const chat = locus({
      locusId: 'locus-runtime-1-aaaa1111',
      chatId: 'oc_a',
      parentSessionId: 'session-1',
      parentAvailability: 'available',
    })
    const stopped = locus({
      locusId: 'locus-runtime-2-bbbb2222',
      chatId: 'oc_b',
      parentSessionId: 'session-1',
      parentAvailability: 'available',
      state: 'stopped',
    })
    const view = applyLocusFilter(snapshot([chat, stopped], [chat.locusId, stopped.locusId]), {
      parentAvailability: ['available'],
      entryStates: ['active'],
    })
    expect(view.works[0]?.families).toHaveLength(1)
    expect(view.hidden.entryStates).toEqual([{ state: 'stopped', label: '已停止', entries: 1 }])
  })

  it('keeps an active topic visible when its chat entry is filtered out', () => {
    const chat = locus({
      locusId: 'locus-runtime-1-aaaa1111',
      chatId: 'oc_a',
      parentSessionId: 'session-1',
      parentAvailability: 'available',
      state: 'stopped',
    })
    const topic = locus({
      locusId: 'locus-runtime-2-bbbb2222',
      chatId: 'oc_a',
      threadId: 'omt_1',
      parentSessionId: 'session-1',
      parentAvailability: 'available',
      parentLocusId: chat.locusId,
    })
    const view = applyLocusFilter(snapshot([chat, topic], [topic.locusId]), {
      parentAvailability: ['available'],
      entryStates: ['active'],
    })
    // The child is an entry with its own state: losing the parent must not take
    // it down, and it becomes a root of the group.
    expect(view.works[0]?.nodes).toHaveLength(1)
    expect(view.works[0]?.nodes[0]?.family.endpoint.threadId).toBe('omt_1')
  })

  it('does not mutate the snapshot', () => {
    const base = realisticSnapshot()
    const before = JSON.stringify(base)
    applyLocusFilter(base, DEFAULT_LOCUS_FILTER)
    expect(JSON.stringify(base)).toBe(before)
  })

  it('matches search text literally, including display codes', () => {
    const view = realisticSnapshot()
    const families = groupByWork(view).flatMap(work => work.families)
    const codes = collectHandleCodes(view)
    const chat = families.find(
      family => family.endpoint.chatId === 'oc_591324b60afa1d62f3e229104607c586' && family.endpoint.threadId === undefined,
    )
    const topic = families.find(family => family.endpoint.threadId !== undefined)
    expect(chat).toBeDefined()
    expect(topic).toBeDefined()
    // Blank matches everything; a code, a chat id and a session title all match;
    // an unrelated word matches nothing (no fuzzy near-misses).
    expect(entryMatchesQuery(chat!, codes, '  ')).toBe(true)
    expect(entryMatchesQuery(topic!, codes, '19cd')).toBe(true)
    expect(entryMatchesQuery(topic!, codes, 'omt_19cd829b840f5bee')).toBe(true)
    expect(entryMatchesQuery(chat!, codes, '答疑 · DSH')).toBe(false)
  })

  it('resolves display codes for a whole snapshot in one pass', () => {
    const codes = collectHandleCodes(realisticSnapshot())
    expect(codes.endpoint.get('oc_b1fa0f02b695fbf4bd4ff2ebb322fad4')).toBe('b1fa')
    expect(codes.endpoint.get('omt_19cd829b840f5bee')).toBe('19cd')
    expect(codes.locus.get('locus-runtime-1789394541339-2f853e76111d38')).toBeUndefined()
    expect(codes.locus.get('locus-runtime-1789398952986-b0d570a7406468')).toBe('b0d5')
    expect(codes.session.get('session-906220d3-ecee-41d0-9320-f425f17edefe')).toBe('9062')
  })

  it('summarises what is on screen', () => {
    const view = applyLocusFilter(realisticSnapshot())
    const summary = summarizeLocusView(view)
    expect(summary.entries).toBe(1)
    expect(summary.chats).toBe(1)
    expect(summary.works).toBe(1)
  })
})
