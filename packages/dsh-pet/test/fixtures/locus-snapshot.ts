/**
 * Snapshot fixtures for the locus surface.
 *
 * The shapes here are the ones that broke the previous layout: a rebuilt entry,
 * a topic inheriting a chat entry, an archived parent whose entries are still
 * active, an entry under construction and a parent with no default Q&A.
 */

import type { PetLocusManagementView, PetLocusSource, PetLocusState, PetLocusView } from '../../src/wire.js'

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

/** One locus generation, with only the fields the surface actually reads. */
export function locusFixture(input: LocusInput): PetLocusView {
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
      workspaceId: input.workspaceId ?? 'd5d2ebd5-7296-42c9-a34a-16753deb417b',
      ...(input.workspaceTitle === undefined ? {} : { title: input.workspaceTitle }),
    },
    permission: { desired: 'read', effective: 'read' },
    state: { state: input.state ?? 'active', busy: false, createdAt: 1, updatedAt: 2 },
    source,
    ...(input.parentLocusId === undefined ? {} : { parentLocusId: input.parentLocusId }),
    isDefaultQa: input.isDefaultQa ?? false,
  }
}

/** Build the discovery indexes the Host derives from the same records. */
export function snapshotOf(
  loci: readonly PetLocusView[],
  currents: readonly string[] = [],
): PetLocusManagementView {
  const currentIds = new Set(currents)
  const byEndpointKey = new Map<string, PetLocusView[]>()
  for (const record of loci) {
    const key = record.endpoint.threadId === undefined
      ? `chat:${record.endpoint.chatId}`
      : `chat:${record.endpoint.chatId}:thread:${record.endpoint.threadId}`
    const list = byEndpointKey.get(key)
    if (list === undefined) byEndpointKey.set(key, [record])
    else list.push(record)
  }
  const byEndpoint = [...byEndpointKey.values()].map(records => {
    const sorted = [...records].sort((left, right) => left.generation - right.generation)
    const first = sorted[0]
    if (first === undefined) throw new Error('fixture: empty endpoint history')
    const current = sorted.find(record => currentIds.has(record.locusId))
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

  const childIds = [
    ...new Set(loci.flatMap(record => (record.child.sessionId === undefined ? [] : [record.child.sessionId]))),
  ]
  const byChild = childIds.map(childSessionId => {
    const match = loci.find(record => record.child.sessionId === childSessionId)
    return {
      childSessionId,
      ...(match === undefined ? {} : { locus: match }),
      history: loci.filter(record => record.child.sessionId === childSessionId),
    }
  })

  return {
    generation: 1,
    loci,
    defaultQa: loci
      .filter(record => record.isDefaultQa)
      .map(record => ({ parentSessionId: record.main.sessionId, locus: record })),
    discovery: { byEndpoint, byParent, byChild },
  }
}

/**
 * Two parent sessions: one usable with a rebuilt default Q&A entry and a topic,
 * one archived with an entry that is nevertheless still provisioning.
 */
export function surfaceSnapshot(): PetLocusManagementView {
  const chatGen1 = locusFixture({
    locusId: 'locus-runtime-1789394541339-2f853e76111d38',
    chatId: 'oc_a27b5de7e6a9a57462060eb289ec70ab',
    parentSessionId: 'session-906220d3-ecee-41d0-9320-f425f17edefe',
    parentTitle: 'pet locus 待办依赖与优先级',
    parentAvailability: 'available',
    childSessionId: 'session-9f6ae48b-1744-4fcc-826b-38d3e52e90a9',
    childTitle: '答疑 · DSH',
    workspaceTitle: 'ohmydsh',
    source: 'qa-created',
    isDefaultQa: true,
  })
  const chatGen2 = locusFixture({
    locusId: 'locus-runtime-1789394541339-aaaaaaaaaaaa',
    generation: 2,
    chatId: 'oc_a27b5de7e6a9a57462060eb289ec70ab',
    parentSessionId: 'session-906220d3-ecee-41d0-9320-f425f17edefe',
    parentTitle: 'pet locus 待办依赖与优先级',
    parentAvailability: 'available',
    childSessionId: 'session-a380ee7b-8b44-406f-80dd-2f1c92023701',
    childTitle: '答疑 · DSH',
    workspaceTitle: 'ohmydsh',
    source: 'qa-created',
    isDefaultQa: true,
  })
  const topic = locusFixture({
    locusId: 'locus-runtime-1789397609276-f750f727f1988',
    chatId: 'oc_a27b5de7e6a9a57462060eb289ec70ab',
    threadId: 'omt_19cd829b840f5bee',
    parentSessionId: 'session-906220d3-ecee-41d0-9320-f425f17edefe',
    parentTitle: 'pet locus 待办依赖与优先级',
    parentAvailability: 'available',
    childSessionId: 'session-19b894b4-49d9-4417-a0f1-e194f0baad6f',
    childTitle: 'Locus 子会话 · oc_a27b5de7… · Locus 主会话 · oc_',
    workspaceTitle: 'ohmydsh',
    source: 'inherited',
    parentLocusId: chatGen2.locusId,
  })
  const building = locusFixture({
    locusId: 'locus-runtime-1789398952986-b0d570a7406468',
    chatId: 'oc_b1fa0f02b695fbf4bd4ff2ebb322fad4',
    parentSessionId: 'session-4629eb39-c996-4ff6-ad0e-b59ac54337a1',
    parentTitle: '未命名会话',
    parentAvailability: 'archived',
    childSessionId: 'session-7b41abe2-f878-4d5c-9cf0-a6b548219c1a',
    childTitle: 'Locus 子会话 · oc_b1fa0f02…',
    workspaceTitle: 'nexus',
    state: 'provisioning',
  })
  return snapshotOf([chatGen1, chatGen2, topic, building], [chatGen2.locusId, topic.locusId, building.locusId])
}
