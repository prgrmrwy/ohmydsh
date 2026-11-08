/**
 * v20 management fixtures (owner D, test-plan "management snapshot builder").
 *
 * Two halves that describe the same thing at two seams:
 * - Host rows (`groupRow` / `topicRow` / `managementRepo`) for `management.ts`;
 * - wire view rows (`entryView` / `chatView` / `workView` / `snapshotV20`) for
 *   `locus-view.ts` and the settings surface.
 */
import type { PetLocusMainRecord } from '../../src/host/spec.js'
import type { LocusGroupRowV20, LocusRowV20, LocusTopicRowV20 } from '../../src/host/locus/contract-v20.js'
import type { LocusManagementRepository } from '../../src/host/locus/management.js'
import type {
  PetLocusChatViewV20,
  PetLocusEntryViewV20,
  PetLocusManagementViewV20,
  PetLocusWorkGroupViewV20,
  PetLocusWorkViewV20,
} from '../../src/wire.js'

// ---------------------------------------------------------------------------
// Host rows
// ---------------------------------------------------------------------------

type Lifecycle = Pick<LocusRowV20, 'state' | 'stoppedAt' | 'invalidReason'>

function lifecycle(state: LocusRowV20['state'] = 'active'): Lifecycle {
  if (state === 'stopped') return { state, stoppedAt: 5 }
  if (state === 'invalid') return { state, invalidReason: 'child lost' }
  return { state }
}

export function groupRow(
  input: { chatId: string; locusId?: string; sessionId?: string; state?: LocusRowV20['state'] } &
    Partial<Omit<LocusGroupRowV20, 'endpoint' | 'state'>>,
): LocusGroupRowV20 {
  const { chatId, state, ...rest } = input
  return {
    endpoint: { chatId },
    locusId: `locus-${chatId}`,
    sessionId: `session-child-${chatId}`,
    accessMode: 'read-only',
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
    locusMainSessionId: 'session-main-1',
    workspaceId: 'ws-1',
    ...lifecycle(state),
    ...rest,
  } as LocusGroupRowV20
}

export function topicRow(
  input: { chatId: string; threadId: string; locusId?: string; sessionId?: string; state?: LocusRowV20['state'] } &
    Partial<Omit<LocusTopicRowV20, 'endpoint' | 'state'>>,
): LocusTopicRowV20 {
  const { chatId, threadId, state, ...rest } = input
  return {
    endpoint: { chatId, threadId },
    locusId: `locus-${chatId}-${threadId}`,
    sessionId: `session-child-${chatId}-${threadId}`,
    accessMode: 'read-only',
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
    ...lifecycle(state),
    ...rest,
  } as LocusTopicRowV20
}

export function mainRecord(locusMainSessionId: string, workSessionId: string): PetLocusMainRecord {
  return {
    locusMainSessionId,
    workSessionId,
    generation: 1,
    status: 'active',
    spaceId: `space-${locusMainSessionId}`,
    workspaceId: 'ws-pet',
    createdAt: 1,
    updatedAt: 1,
  }
}

/** In-memory repository seam with mutable rows and delivery facts. */
export function managementRepo(input: {
  rows: readonly LocusRowV20[]
  mains?: readonly PetLocusMainRecord[]
  inFlight?: readonly string[]
  current?: readonly string[]
}): LocusManagementRepository & { rows: LocusRowV20[]; inFlight: Set<string>; current: Set<string> } {
  const state = {
    rows: [...input.rows],
    inFlight: new Set(input.inFlight ?? []),
    current: new Set(input.current ?? []),
  }
  const mains = input.mains ?? [mainRecord('session-main-1', 'session-work-1')]
  return {
    get rows() { return state.rows },
    set rows(next) { state.rows = next },
    inFlight: state.inFlight,
    current: state.current,
    listRows: () => state.rows,
    findMain: id => mains.find(main => main.locusMainSessionId === id),
    hasNonTerminalDelivery: id => state.inFlight.has(id) || state.current.has(id),
    hasCurrentDelivery: id => state.current.has(id),
  }
}

// ---------------------------------------------------------------------------
// Wire view rows
// ---------------------------------------------------------------------------

export function entryView(
  input: Partial<PetLocusEntryViewV20> & { chatId: string; threadId?: string; chatName?: string; quote?: string; docUrl?: string },
): PetLocusEntryViewV20 {
  const { chatId, threadId, chatName, quote, docUrl, ...rest } = input
  const key = threadId === undefined ? chatId : `${chatId}-${threadId}`
  const state = rest.state ?? 'active'
  return {
    locusId: `locus-${key}`,
    revision: 1,
    endpoint: {
      chatId,
      ...(threadId === undefined ? {} : { threadId }),
      ...(chatName === undefined ? {} : { chatName }),
      ...(quote === undefined ? {} : { quote }),
      ...(docUrl === undefined ? {} : { docUrl }),
    },
    sessionId: `session-child-${key}`,
    ...(state === 'not-created' ? {} : { session: { title: `子会话 ${key}`, availability: 'available' as const } }),
    accessMode: 'read-only',
    inFlight: false,
    hasCurrentDelivery: false,
    createdAt: 1,
    updatedAt: 2,
    ...(state === 'stopped' ? { stoppedAt: 2 } : {}),
    ...(state === 'invalid' ? { invalidReason: 'child lost' } : {}),
    ...rest,
    state,
  }
}

export function chatView(
  group: PetLocusEntryViewV20,
  topics: readonly PetLocusEntryViewV20[] = [],
  extra: Partial<Omit<PetLocusChatViewV20, 'group' | 'topics'>> = {},
): PetLocusChatViewV20 {
  return {
    group,
    topics,
    locusMain: { sessionId: 'session-main-1', title: 'locus 主会话', availability: 'available' },
    workspace: { workspaceId: 'd5d2ebd5-7296-42c9-a34a-16753deb417b', title: 'ohmydsh' },
    ...extra,
  }
}

export function workView(
  chats: readonly PetLocusChatViewV20[],
  work: Partial<PetLocusWorkViewV20> = {},
): PetLocusWorkGroupViewV20 {
  return {
    work: { sessionId: 'session-906220d3-ecee-41d0-9320-f425f17edefe', title: '工作会话', availability: 'available', ...work },
    chats,
  }
}

export function snapshotV20(
  works: readonly PetLocusWorkGroupViewV20[],
  options: { writeEnabled?: boolean } = {},
): PetLocusManagementViewV20 {
  return { generation: 1, works, writeEnabled: options.writeEnabled ?? false }
}
