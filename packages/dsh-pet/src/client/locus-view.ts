/**
 * Pure presentation model for the locus management surface.
 *
 * Everything here is a function of the Host snapshot
 * (`PetLocusManagementView`) and nothing else: no fetch, no React, no storage.
 * Two reasons that separation is worth a module of its own.
 *
 * First, the decision rules are the part worth testing. The previous surface
 * pinned itself with `readFileSync`-style source checks, which can only prove
 * that a string was written — never that the right locus was grouped under the
 * right session for a snapshot containing a topic, a retired generation or an
 * archived parent.
 *
 * Second, every fact shown must come from the Host. This module therefore
 * derives *labels and groupings* only:
 *
 *  - it never decides which generation is current; the Host's
 *    `discovery.byEndpoint[].current` does (aggregate.ts treats
 *    provisioning|active|switching as current and invalid|stopped|retired as
 *    unavailable), and re-deriving that here would create a second truth;
 *  - it never guesses a platform fact the Host did not provide — a chat whose
 *    `chatType` is unknown is an 「入口」, never a 「群」;
 *  - it never turns a display alias into an identity: short codes are derived
 *    for display and are not accepted as input anywhere.
 */

import type {
  PetLocusConfirmAnchorAction,
  PetLocusChildSessionView,
  PetLocusEndpointView,
  PetLocusMainSessionView,
  PetLocusManagementView,
  PetLocusSource,
  PetLocusState,
  PetLocusView,
  PetLocusWorkspaceView,
} from '../wire.js'

// ---------------------------------------------------------------------------
// Short codes (design D2)
// ---------------------------------------------------------------------------

/**
 * Which identifier a short code is derived from.
 *
 * Each kind has exactly one documented rule, because "take the first four
 * characters" produces a useless code for a `locus-runtime-<timestamp>-<hex>`
 * id (the timestamp is not distinguishing) and a misleading one for a session
 * (where the first uuid group is the stable discriminator).
 */
export type HandleKind = 'locus' | 'session' | 'endpoint' | 'workspace'

/** Shortest code length; collisions extend it rather than changing identity. */
const HANDLE_LENGTHS = [4, 6, 8] as const

/**
 * The substring a short code is sliced from.
 *
 * The source is CONTIGUOUS on purpose. Slicing a fixed field (the first uuid
 * group, say) would make two ids that share that field indistinguishable at any
 * length — the code could never grow to separate them. Removing the separators
 * keeps the documented first-4 rule identical for real ids while letting a
 * collision extend across field boundaries.
 *
 * @param id - The real identifier.
 * @param kind - Which object the identifier names.
 * @returns the distinguishing substring, or `''` when the id carries none.
 */
export function handleSource(id: string, kind: HandleKind): string {
  const trimmed = id.trim()
  if (trimmed === '') return ''
  switch (kind) {
    case 'endpoint': {
      // `oc_…` / `omt_…`: everything after the type prefix is the platform id.
      const separator = trimmed.indexOf('_')
      return separator === -1 ? trimmed : trimmed.slice(separator + 1)
    }
    case 'session': {
      // `session-<uuid>`: the uuid, separators removed, so the code starts at
      // the first group and can extend into the second when it must.
      const withoutPrefix = trimmed.startsWith('session-') ? trimmed.slice('session-'.length) : trimmed
      return withoutPrefix.replaceAll('-', '')
    }
    case 'locus': {
      // `locus-runtime-<timestamp>-<hex>`: the LAST segment is the only part
      // with discriminating entropy — the timestamp segment is not.
      const segments = trimmed.split('-')
      return segments[segments.length - 1] ?? ''
    }
    case 'workspace': {
      // A bare uuid: the first group is conventionally the distinguishing one.
      return trimmed.replaceAll('-', '')
    }
  }
}

/**
 * One short code at a fixed length.
 *
 * @param id - The real identifier.
 * @param kind - Which object the identifier names.
 * @param length - Characters to keep from {@link handleSource}.
 * @returns the code, or `''` when the id is empty.
 */
export function handleCode(id: string, kind: HandleKind, length: number = HANDLE_LENGTHS[0]): string {
  return handleSource(id, kind).slice(0, length)
}

/**
 * Short codes for a whole set of identifiers, extended only where they collide.
 *
 * Collisions are resolved in the DISPLAY layer by lengthening the colliding
 * codes (4 → 6 → 8, then the full identifier as a last resort). The underlying
 * identifiers are never rewritten: a code is an alias that helps a human tell
 * two rows apart, not a new identity.
 *
 * @param ids - Identifiers to alias; duplicates and blanks are ignored.
 * @param kind - Which object the identifiers name.
 * @returns a map from identifier to its display code.
 */
export function assignHandleCodes(ids: readonly string[], kind: HandleKind): ReadonlyMap<string, string> {
  const unique = [...new Set(ids.map(id => id.trim()).filter(id => id !== ''))]
  const codes = new Map<string, string>()
  for (const id of unique) codes.set(id, handleCode(id, kind, HANDLE_LENGTHS[0]))

  for (let step = 1; step <= HANDLE_LENGTHS.length; step += 1) {
    const seen = new Map<string, number>()
    for (const code of codes.values()) seen.set(code, (seen.get(code) ?? 0) + 1)
    const colliding = unique.filter(id => (seen.get(codes.get(id) ?? '') ?? 0) > 1)
    if (colliding.length === 0) break
    const next: number | undefined = HANDLE_LENGTHS[step]
    if (next === undefined) {
      // The distinguishing substrings are identical (two ids that differ only
      // outside it). Fall back to the full identifier for exactly these rows so
      // no two rows ever share an alias.
      for (const id of colliding) codes.set(id, id)
      break
    }
    for (const id of colliding) codes.set(id, handleSource(id, kind).slice(0, next))
  }
  return codes
}

/**
 * The type-bearing form of a short code, as the surface shows it.
 *
 * The prefix is not decoration: the identifiers row lists a locus, a chat, a
 * topic, two sessions and a workspace together, and six bare hex fragments
 * cannot be told apart. Endpoints use the platform's own prefix (see
 * {@link endpointHandleLabel}) so a chat and its topic differ at a glance.
 * @param kind - Which object the code names.
 * @param code - The code from {@link assignHandleCodes}.
 * @returns the labelled code, or an empty string for an empty code.
 */
export function handleLabel(kind: HandleKind, code: string): string {
  if (code === '') return ''
  const prefix = kind === 'locus' ? 'L' : kind === 'session' ? 'S' : kind === 'workspace' ? 'W' : 'E'
  return `${prefix}·${code}`
}

/** The labelled code for an endpoint, using `oc`/`omt` as the platform does. */
export function endpointHandleLabel(endpoint: PetLocusEndpointView, code: string): string {
  if (code === '') return ''
  return `${endpoint.threadId === undefined ? 'oc' : 'omt'}·${code}`
}

/** The identifier a locus's short code is derived from. */
export function locusHandleId(locus: PetLocusView): string {
  return locus.locusId
}

/**
 * The identifier an endpoint's short code is derived from.
 *
 * A topic is addressed by its thread id: showing the chat code on a topic row
 * would alias two different entries to the same handle.
 * @param endpoint - The endpoint.
 * @returns the thread id when present, otherwise the chat id.
 */
export function endpointHandleId(endpoint: PetLocusEndpointView): string {
  return endpoint.threadId ?? endpoint.chatId
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Owner-facing names for the six lifecycle states.
 *
 * All six are listed on purpose. `provisioning` is a real transient state since
 * the tree is built on demand by the first qualifying message, and it can
 * persist when provisioning fails — a surface that skips it would show an entry
 * under construction as blank.
 */
export const LOCUS_STATE_LABELS: Record<PetLocusState, string> = {
  provisioning: '准备中',
  active: '活跃',
  switching: '切换中',
  invalid: '已失效',
  stopped: '已停止',
  retired: '已退役',
}

/** Colours are a second channel only: every state also has a word. */
export type LocusTone = 'on' | 'warn' | 'off' | 'gone'

const LOCUS_STATE_TONES: Record<PetLocusState, LocusTone> = {
  active: 'on',
  provisioning: 'warn',
  switching: 'warn',
  stopped: 'warn',
  invalid: 'off',
  retired: 'gone',
}

/**
 * The label for one lifecycle state.
 *
 * Unknown input degrades to an explicit word rather than an empty cell: the
 * union is closed today, but a Host that starts reporting a new state must be
 * visible on screen instead of silently blank.
 * @param state - State reported by the Host.
 * @returns the owner-facing label.
 */
export function locusStateLabel(state: PetLocusState | string): string {
  return LOCUS_STATE_LABELS[state as PetLocusState] ?? '未知状态'
}

/** The tone for one lifecycle state, defaulting to the neutral "retired" grey. */
export function locusStateTone(state: PetLocusState | string): LocusTone {
  return LOCUS_STATE_TONES[state as PetLocusState] ?? 'gone'
}

/**
 * Where an association came from.
 *
 * `qa-created` reads as 「答疑群建立」, NOT 「默认 Q&A」. The two are different
 * facts: this field records which action created the association, while
 * `isDefaultQa` records whether it is the session's default entry. Conflating
 * them labelled非默认 loci as 「默认 Q&A」.
 */
export const LOCUS_SOURCE_LABELS: Record<PetLocusSource, string> = {
  auto: '自动建立',
  inherited: '继承群级来源',
  explicit: '显式绑定',
  'qa-created': '答疑群建立',
}

/** The label for one association source. */
export function locusSourceLabel(source: PetLocusSource | string): string {
  return LOCUS_SOURCE_LABELS[source as PetLocusSource] ?? '未知来源'
}

/**
 * How the entry-state half of the filter reads on the collapsed filter button.
 *
 * A filter that hides terminal entries by default must say so in its closed
 * state too: the button is the only thing on screen while the popover is shut,
 * and an owner whose stopped entry is missing needs to see that entry states —
 * not only parent states — are part of the condition.
 * @param states - Entry states currently selected.
 * @returns the short owner-facing condition label.
 */
export function entryStateFilterLabel(states: readonly PetLocusState[]): string {
  const selected = new Set(states)
  if (ALL_ENTRY_STATES.every(state => selected.has(state))) return '全部'
  if (
    selected.size === SERVABLE_ENTRY_STATES.length &&
    SERVABLE_ENTRY_STATES.every(state => selected.has(state))
  ) {
    return '在服务'
  }
  return `${selected.size}/${ALL_ENTRY_STATES.length} 类`
}

/** Parent-session availability collapsed into the filter's three buckets. */
export type ParentAvailability = 'available' | 'archived' | 'unverified'

export const PARENT_AVAILABILITY_LABELS: Record<ParentAvailability, string> = {
  available: '可用',
  archived: '已归档',
  // `missing` (the session cannot be opened) and an omitted fact (the Host
  // could not resolve one) are both "not proven usable", which is what this
  // bucket means; they are not the same evidence, so the label names both.
  unverified: '未核验 / 不可用',
}

/**
 * Collapse a session's reported availability into a filter bucket.
 * @param session - Main session facts, when the Host provided them.
 * @returns the bucket used by the parent-state filter.
 */
export function parentAvailabilityOf(session: PetLocusMainSessionView | undefined): ParentAvailability {
  if (session?.availability === 'available') return 'available'
  if (session?.availability === 'archived') return 'archived'
  return 'unverified'
}

/** Owner-facing label for a session availability value. */
export function sessionAvailabilityLabel(availability: 'available' | 'archived' | 'missing' | undefined): string {
  if (availability === 'available') return '可用'
  if (availability === 'archived') return '已归档'
  if (availability === 'missing') return '不可用'
  return '未核验'
}

/** Whether a session reported by the Host can be navigated to. */
export function isSessionOpenable(availability: 'available' | 'archived' | 'missing' | undefined): boolean {
  return availability !== 'archived' && availability !== 'missing'
}

// ---------------------------------------------------------------------------
// Names (design D8, D9)
// ---------------------------------------------------------------------------

/** What an endpoint is, in the owner's vocabulary. */
export interface EndpointRole {
  /** `话题` for a thread endpoint, otherwise `入口`. */
  readonly label: string
  readonly isTopic: boolean
}

/**
 * The role word for an endpoint.
 *
 * A chat-level endpoint is 「入口」 and never 「群」: `chatType` is not
 * persisted, and a p2p conversation uses the same `oc_` id shape as a group, so
 * calling it a group would be a guess presented as a fact.
 * @param endpoint - The endpoint.
 * @returns the role word.
 */
export function endpointRole(endpoint: PetLocusEndpointView): EndpointRole {
  return endpoint.threadId === undefined
    ? { label: '入口', isTopic: false }
    : { label: '话题', isTopic: true }
}

/** A row's display name plus whether it is a placeholder rather than a real name. */
export interface EntryDisplayName {
  readonly name: string
  /** True when the platform provided no name and this is a fallback. */
  readonly isPlaceholder: boolean
  readonly role: EndpointRole
}

/**
 * The name shown for one entry.
 *
 * Real names win. When the platform provides none, the fallback is
 * `<role> · <short code>`; the code carries the distinguishing power, so the
 * row never depends on a name being available.
 * @param endpoint - The endpoint.
 * @param shortCode - This endpoint's display code.
 * @returns the name and whether it is a placeholder.
 */
export function entryDisplayName(endpoint: PetLocusEndpointView, shortCode: string): EntryDisplayName {
  const role = endpointRole(endpoint)
  const provided = endpoint.chatName?.trim() ?? ''
  if (provided !== '') return { name: provided, isPlaceholder: false, role }
  const suffix = shortCode.trim() === '' ? endpointHandleId(endpoint) : shortCode.trim()
  return { name: `${role.label} · ${suffix}`, isPlaceholder: true, role }
}

// ---------------------------------------------------------------------------
// Aggregation: one row per entry (design D1)
// ---------------------------------------------------------------------------

/**
 * The stable key for one endpoint inside the snapshot.
 *
 * The chat id alone is not an endpoint: a chat and its topic are different
 * entries, and a snapshot legitimately contains both.
 * @param endpoint - The endpoint.
 * @returns a key unique per (chatId, threadId) pair.
 */
export function endpointKey(endpoint: PetLocusEndpointView): string {
  return endpoint.threadId === undefined
    ? `chat:${endpoint.chatId}`
    : `chat:${endpoint.chatId}:thread:${endpoint.threadId}`
}

/** The chat a family belongs to, regardless of whether it is the topic. */
export function chatKey(endpoint: PetLocusEndpointView): string {
  return `chat:${endpoint.chatId}`
}

/** One entry's full generation history, newest first. */
export interface LocusFamily {
  readonly key: string
  readonly endpoint: PetLocusEndpointView
  /** The generation the Host designates as current, when it designates one. */
  readonly current?: PetLocusView
  /** Every generation of this endpoint, newest first. */
  readonly generations: readonly PetLocusView[]
  /** The generations other than {@link current}: what 「历史 N 代」 discloses. */
  readonly history: readonly PetLocusView[]
}

function byGenerationDesc(left: PetLocusView, right: PetLocusView): number {
  if (left.generation !== right.generation) return right.generation - left.generation
  return left.locusId.localeCompare(right.locusId)
}

/** The generation a family presents on its main row. */
export function familyHead(family: LocusFamily): PetLocusView | undefined {
  return family.current ?? family.generations[0]
}

/**
 * Whether the Host designated this generation as the entry's current one.
 *
 * Callers must gate the 「当前代」 marker on THIS, never on "it is the newest
 * generation". The Host deliberately reports no current generation when its
 * index has nothing to say, because a missing index is not proof of
 * routability; presenting the newest record as current would revive an endpoint
 * the Host refuses to route.
 * @param family - The entry.
 * @param locus - One of its generations.
 * @returns true only when the snapshot's index names this exact generation.
 */
export function isHostCurrent(family: LocusFamily, locus: PetLocusView): boolean {
  return family.current?.locusId === locus.locusId
}

/**
 * Aggregate records into one family per endpoint.
 *
 * The snapshot's `loci` is every generation ever recorded, including stopped and
 * retired ones, which is why the previous surface rendered a rebuilt entry as
 * several cards. Current-ness is read from the Host index, never re-derived.
 * @param snapshot - Complete management snapshot.
 * @returns families in a deterministic order.
 */
export function groupLociByEndpoint(snapshot: PetLocusManagementView): readonly LocusFamily[] {
  const byEndpoint = new Map<string, PetLocusView[]>()
  for (const locus of snapshot.loci) {
    const key = endpointKey(locus.endpoint)
    const list = byEndpoint.get(key)
    if (list === undefined) byEndpoint.set(key, [locus])
    else list.push(locus)
  }

  const currentByEndpoint = new Map<string, PetLocusView>()
  for (const entry of snapshot.discovery.byEndpoint) {
    if (entry.current !== undefined) currentByEndpoint.set(endpointKey(entry.endpoint), entry.current)
  }

  const families: LocusFamily[] = []
  for (const [key, records] of byEndpoint) {
    const generations = [...records].sort(byGenerationDesc)
    const head = generations[0]
    // Unreachable: a key exists only because a record created it. The guard
    // keeps the module honest under `noUncheckedIndexedAccess` rather than
    // asserting with `!`.
    if (head === undefined) continue
    const current = currentByEndpoint.get(key)
    families.push({
      key,
      endpoint: (current ?? head).endpoint,
      ...(current === undefined ? {} : { current }),
      generations,
      history: generations.filter(locus => locus.locusId !== current?.locusId),
    })
  }
  return families.sort((left, right) => left.key.localeCompare(right.key))
}

// ---------------------------------------------------------------------------
// Reading A: by work (parent session) (design D3)
// ---------------------------------------------------------------------------

/** One entry plus the topic entries that inherit from it. */
export interface LocusFamilyNode {
  readonly family: LocusFamily
  readonly children: readonly LocusFamilyNode[]
}

/** One parent session and the entries that belong to it. */
export interface WorkGroup {
  readonly parentSessionId: string
  /** Parent-session facts exactly as the Host reported them. */
  readonly session?: PetLocusMainSessionView
  readonly availability: ParentAvailability
  readonly workspace?: PetLocusWorkspaceView
  /** Entry roots; topic entries hang off the chat-level entry they inherit. */
  readonly nodes: readonly LocusFamilyNode[]
  /** The same families, flat, for counting and filtering. */
  readonly families: readonly LocusFamily[]
}

const STATE_RANK: Record<PetLocusState, number> = {
  active: 0,
  provisioning: 1,
  switching: 2,
  stopped: 3,
  invalid: 4,
  retired: 5,
}

function stateRankOf(family: LocusFamily): number {
  const head = familyHead(family)
  return head === undefined ? 9 : STATE_RANK[head.state.state] ?? 9
}

function familySortKey(family: LocusFamily): string {
  const name = family.endpoint.chatName?.trim()
  return name === undefined || name === '' ? family.key : name
}

/**
 * Group families under the parent session that owns them.
 *
 * A parent session is rendered once: its title, workspace and availability are
 * facts about the work, not about each entry, and repeating them was what made
 * the old surface scroll for four screens.
 *
 * Topic nesting follows `parentLocusId`, but only inside the same work group —
 * a topic whose chat-level entry belongs to a different parent session is
 * rendered as a root, because nesting it elsewhere would put a row under a
 * session it does not belong to.
 * @param snapshot - Complete management snapshot.
 * @returns work groups, live work first.
 */
export function groupByWork(snapshot: PetLocusManagementView): readonly WorkGroup[] {
  const families = groupLociByEndpoint(snapshot)
  const groups = new Map<string, LocusFamily[]>()
  for (const family of families) {
    const head = familyHead(family)
    if (head === undefined) continue
    const list = groups.get(head.main.sessionId)
    if (list === undefined) groups.set(head.main.sessionId, [family])
    else list.push(family)
  }

  const works: WorkGroup[] = []
  for (const [parentSessionId, members] of groups) {
    const head = members[0]
    const firstHead = head === undefined ? undefined : familyHead(head)
    const ordered = [...members].sort((left, right) => {
      const rank = stateRankOf(left) - stateRankOf(right)
      if (rank !== 0) return rank
      const byName = familySortKey(left).localeCompare(familySortKey(right))
      return byName !== 0 ? byName : left.key.localeCompare(right.key)
    })

    const byLocusId = new Map<string, LocusFamily>()
    for (const family of ordered) {
      for (const generation of family.generations) {
        // First write wins: the highest generation of an endpoint owns the id.
        if (!byLocusId.has(generation.locusId)) byLocusId.set(generation.locusId, family)
      }
    }

    const children = new Map<string, LocusFamily[]>()
    const roots: LocusFamily[] = []
    for (const family of ordered) {
      const familyHeadLocus = familyHead(family)
      const parentLocusId = familyHeadLocus?.parentLocusId
      const parentFamily = parentLocusId === undefined ? undefined : byLocusId.get(parentLocusId)
      if (parentFamily === undefined || parentFamily === family) {
        roots.push(family)
        continue
      }
      const list = children.get(parentFamily.key)
      if (list === undefined) children.set(parentFamily.key, [family])
      else list.push(family)
    }

    const toNode = (family: LocusFamily): LocusFamilyNode => ({
      family,
      children: (children.get(family.key) ?? []).map(toNode),
    })

    works.push({
      parentSessionId,
      ...(firstHead === undefined ? {} : { session: firstHead.main }),
      availability: parentAvailabilityOf(firstHead?.main),
      ...(firstHead === undefined || firstHead.workspace === undefined
        ? {}
        : { workspace: firstHead.workspace }),
      nodes: roots.map(toNode),
      families: ordered,
    })
  }

  return works.sort((left, right) => {
    const rank = availabilityRank(left.availability) - availabilityRank(right.availability)
    if (rank !== 0) return rank
    const byName = (left.session?.title ?? '').localeCompare(right.session?.title ?? '')
    return byName !== 0 ? byName : left.parentSessionId.localeCompare(right.parentSessionId)
  })
}

function availabilityRank(availability: ParentAvailability): number {
  if (availability === 'available') return 0
  if (availability === 'archived') return 1
  return 2
}

// ---------------------------------------------------------------------------
// Reading B: by entry (design D3)
// ---------------------------------------------------------------------------

/** One chat and the entries addressed through it (itself plus its topics). */
export interface EntryGroup {
  readonly chatId: string
  readonly key: string
  /** Chat-level endpoint; topic endpoints are the family's own. */
  readonly endpoint: PetLocusEndpointView
  readonly chatFamily?: LocusFamily
  readonly topicFamilies: readonly LocusFamily[]
  /** Chat-level entry first, then topics. */
  readonly families: readonly LocusFamily[]
}

/**
 * Group families by chat so the reverse reading answers "what is this door
 * connected to" without leaving the snapshot.
 * @param snapshot - Complete management snapshot.
 * @returns entry groups in a deterministic order.
 */
export function groupByEntry(snapshot: PetLocusManagementView): readonly EntryGroup[] {
  const families = groupLociByEndpoint(snapshot)
  const groups = new Map<string, LocusFamily[]>()
  for (const family of families) {
    const key = chatKey(family.endpoint)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [family])
    else list.push(family)
  }

  const result: EntryGroup[] = []
  for (const [key, members] of groups) {
    const ordered = [...members].sort((left, right) => {
      const rank = stateRankOf(left) - stateRankOf(right)
      return rank !== 0 ? rank : left.key.localeCompare(right.key)
    })
    const chatFamily = ordered.find(family => family.endpoint.threadId === undefined)
    const topicFamilies = ordered.filter(family => family.endpoint.threadId !== undefined)
    const head = chatFamily ?? ordered[0]
    if (head === undefined) continue
    result.push({
      chatId: head.endpoint.chatId,
      key,
      endpoint: chatFamily?.endpoint ?? { chatId: head.endpoint.chatId },
      ...(chatFamily === undefined ? {} : { chatFamily }),
      topicFamilies,
      families: ordered,
    })
  }
  return result.sort((left, right) => left.key.localeCompare(right.key))
}

// ---------------------------------------------------------------------------
// Filtering (design D5)
// ---------------------------------------------------------------------------

/** Options for one entry-state bucket in the filter popover. */
export interface EntryStateOption {
  readonly id: string
  readonly label: string
  readonly states: readonly PetLocusState[]
}

/**
 * Entry states grouped for filtering.
 *
 * Grouped rather than listed one state per row because the owner's question is
 * "is this door working", not "which of six states is it" — but every state
 * appears in exactly one bucket, so no state can become unfilterable.
 */
export const ENTRY_STATE_OPTIONS: readonly EntryStateOption[] = [
  { id: 'active', label: '活跃', states: ['active'] },
  { id: 'in-flight', label: '准备中 / 切换中', states: ['provisioning', 'switching'] },
  { id: 'stopped', label: '已停止 / 已失效', states: ['stopped', 'invalid'] },
  { id: 'retired', label: '已退役', states: ['retired'] },
]

/** The filter's current condition. */
export interface LocusFilter {
  readonly parentAvailability: readonly ParentAvailability[]
  readonly entryStates: readonly PetLocusState[]
}

/** Every lifecycle state, in the order this surface ranks them. */
export const ALL_ENTRY_STATES: readonly PetLocusState[] = [
  'active',
  'provisioning',
  'switching',
  'stopped',
  'invalid',
  'retired',
]

/**
 * The states whose entries are still being served.
 *
 * The complement is exactly the unavailable trio (`stopped` / `invalid` /
 * `retired`): the Host refuses work for those endpoints and the only way
 * forward is an explicit rebuild (`repository.ts`: *explicitly rebuild it
 * before accepting work*).
 */
export const SERVABLE_ENTRY_STATES: readonly PetLocusState[] = ['active', 'provisioning', 'switching']

/** The unfiltered condition: every parent state and every entry state. */
export const SHOW_ALL_LOCUS_FILTER: LocusFilter = {
  parentAvailability: ['available', 'archived', 'unverified'],
  entryStates: [...ALL_ENTRY_STATES],
}

/**
 * The default condition: usable work, and entries that are still being served.
 *
 * Both halves hide something. The disclosure is the filter control itself — it
 * states the current condition on its own face and its popover counts every
 * bucket over the whole snapshot — so the list adds no separate "hidden" row:
 * an inline exit for something the filter already names was noise, and the row
 * it occupied pushed the entries down.
 */
export const DEFAULT_LOCUS_FILTER: LocusFilter = {
  parentAvailability: ['available'],
  entryStates: [...SERVABLE_ENTRY_STATES],
}

/** A snapshot narrowed to what the current condition shows. */
export interface FilteredLocusView {
  readonly works: readonly WorkGroup[]
  readonly entries: readonly EntryGroup[]
}

function keepFamily(family: LocusFamily, states: ReadonlySet<PetLocusState>): boolean {
  const head = familyHead(family)
  return head !== undefined && states.has(head.state.state)
}

function filterNodes(
  nodes: readonly LocusFamilyNode[],
  states: ReadonlySet<PetLocusState>,
): readonly LocusFamilyNode[] {
  const result: LocusFamilyNode[] = []
  for (const node of nodes) {
    const children = filterNodes(node.children, states)
    if (keepFamily(node.family, states)) result.push({ family: node.family, children })
    // A filtered-out parent must not take its children down with it: the child
    // is an independent entry with its own state and its own row.
    else result.push(...children)
  }
  return result
}

/**
 * Apply the filter to a snapshot.
 *
 * Pure: the returned groups are new objects and the snapshot is untouched, so
 * nothing about filtering can be mistaken for a data change.
 * @param snapshot - Complete management snapshot.
 * @param filter - The condition to apply.
 * @returns the readings the condition keeps.
 */
export function applyLocusFilter(
  snapshot: PetLocusManagementView,
  filter: LocusFilter = DEFAULT_LOCUS_FILTER,
): FilteredLocusView {
  const availability = new Set(filter.parentAvailability)
  const states = new Set(filter.entryStates)
  const allWorks = groupByWork(snapshot)

  const works: WorkGroup[] = []

  for (const work of allWorks) {
    if (!availability.has(work.availability)) continue
    const nodes = filterNodes(work.nodes, states)
    const families = flattenNodes(nodes)
    // A work section with nothing under it is not a reading: an empty header
    // would push the owner to hunt for what is missing instead of reading the
    // condition stated on the filter control.
    if (families.length === 0) continue
    works.push({ ...work, nodes, families })
  }

  const visibleKeys = new Set(works.flatMap(work => work.families).map(family => family.key))

  const allEntries = groupByEntry(snapshot)
  const entries = allEntries
    .map(group => ({
      ...group,
      topicFamilies: group.topicFamilies.filter(family => visibleKeys.has(family.key)),
      families: group.families.filter(family => visibleKeys.has(family.key)),
    }))
    .filter(group => group.families.length > 0)

  return { works, entries }
}

function flattenNodes(nodes: readonly LocusFamilyNode[]): readonly LocusFamily[] {
  const result: LocusFamily[] = []
  for (const node of nodes) {
    result.push(node.family, ...flattenNodes(node.children))
  }
  return result
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Narrow a filtered view to the entries matching the search text.
 *
 * Search never resurrects what the filter hid: it narrows an already-filtered
 * view, so "hidden" stays a property of the filter and the hidden note keeps
 * meaning the same thing whether or not a query is active.
 * @param view - An already filtered view.
 * @param codes - Display codes for the snapshot.
 * @param query - Raw search text; blank keeps everything.
 * @returns a view with only matching entries, plus the same hidden summary.
 */
export function applyQuery(view: FilteredLocusView, codes: HandleCodes, query: string): FilteredLocusView {
  if (query.trim() === '') return view
  const keep = (nodes: readonly LocusFamilyNode[]): readonly LocusFamilyNode[] => {
    const result: LocusFamilyNode[] = []
    for (const node of nodes) {
      const children = keep(node.children)
      if (entryMatchesQuery(node.family, codes, query)) result.push({ family: node.family, children })
      else result.push(...children)
    }
    return result
  }
  const keepFamilies = (families: readonly LocusFamily[]): readonly LocusFamily[] =>
    families.filter(family => entryMatchesQuery(family, codes, query))

  const works = view.works
    .map(work => {
      const nodes = keep(work.nodes)
      return { ...work, nodes, families: flattenNodes(nodes) }
    })
    .filter(work => work.families.length > 0)

  const entries = view.entries
    .map(group => {
      const families = keepFamilies(group.families)
      return {
        ...group,
        chatFamily: group.chatFamily === undefined || !families.includes(group.chatFamily)
          ? undefined
          : group.chatFamily,
        topicFamilies: group.topicFamilies.filter(family => families.includes(family)),
        families,
      }
    })
    .map(group => {
      const { chatFamily, ...rest } = group
      return chatFamily === undefined ? rest : { ...rest, chatFamily }
    })
    .filter(group => group.families.length > 0)

  return { works, entries }
}

// ---------------------------------------------------------------------------
// Header summary
// ---------------------------------------------------------------------------

/**
 * Counts for the filter panel.
 *
 * Counts come from the unfiltered snapshot: a checkbox that showed the number
 * of rows it currently leaves visible would always read 0 for the thing the
 * owner is trying to find.
 */
export interface LocusFilterCounts {
  readonly parent: ReadonlyMap<ParentAvailability, number>
  readonly entry: ReadonlyMap<string, number>
}

/**
 * Count what each filter option would reveal.
 * @param snapshot - Complete management snapshot.
 * @returns parent buckets by availability and entries per state option.
 */
export function countLocusFilterOptions(snapshot: PetLocusManagementView): LocusFilterCounts {
  const parent = new Map<ParentAvailability, number>()
  for (const work of groupByWork(snapshot)) {
    parent.set(work.availability, (parent.get(work.availability) ?? 0) + 1)
  }
  const entry = new Map<string, number>()
  for (const family of groupLociByEndpoint(snapshot)) {
    const head = familyHead(family)
    if (head === undefined) continue
    for (const option of ENTRY_STATE_OPTIONS) {
      if (!option.states.includes(head.state.state)) continue
      entry.set(option.id, (entry.get(option.id) ?? 0) + 1)
    }
  }
  return { parent, entry }
}

/** The one-line reading above the list. */
export interface LocusSummary {
  readonly entries: number
  readonly chats: number
  readonly works: number
  readonly currentGenerations: number
  readonly historyGenerations: number
}

/**
 * Count what the visible surface currently shows.
 * @param view - A filtered view.
 * @returns the counts used by the header line.
 */
export function summarizeLocusView(view: FilteredLocusView): LocusSummary {
  const families = view.works.flatMap(work => work.families)
  const chats = new Set(families.map(family => family.endpoint.chatId))
  return {
    entries: families.length,
    chats: chats.size,
    works: view.works.length,
    currentGenerations: families.filter(family => family.current !== undefined).length,
    historyGenerations: families.reduce((total, family) => total + family.history.length, 0),
  }
}

// ---------------------------------------------------------------------------
// Session references
// ---------------------------------------------------------------------------

/** The child session of a generation, when provisioning produced one. */
export function childOf(locus: PetLocusView): PetLocusChildSessionView {
  return locus.child
}

/**
 * Whether an entry matches the owner's search text.
 *
 * Matching is deliberately literal — names, the display codes and the real
 * identifiers are all searched, and nothing is fuzzy-matched. A search that
 * silently returned near-misses would be worse than no search here, because the
 * surface is used to decide which entry to stop or rebuild.
 *
 * @param family - The entry to test.
 * @param codes - Display codes for the snapshot, so a code typed by the owner matches.
 * @param query - Raw search text; blank matches everything.
 * @returns true when the entry should stay visible.
 */
export function entryMatchesQuery(
  family: LocusFamily,
  codes: HandleCodes,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const haystack: string[] = [family.endpoint.chatId]
  if (family.endpoint.threadId !== undefined) haystack.push(family.endpoint.threadId)
  if (family.endpoint.chatName !== undefined) haystack.push(family.endpoint.chatName)
  const endpointCode = codes.endpoint.get(endpointHandleId(family.endpoint))
  if (endpointCode !== undefined) haystack.push(endpointCode)
  for (const generation of family.generations) {
    haystack.push(generation.locusId)
    const locusCode = codes.locus.get(generation.locusId)
    if (locusCode !== undefined) haystack.push(locusCode)
    haystack.push(generation.main.sessionId, generation.main.title ?? '')
    if (generation.child.sessionId !== undefined) haystack.push(generation.child.sessionId)
    if (generation.child.title !== undefined) haystack.push(generation.child.title)
    const parentCode = codes.session.get(generation.main.sessionId)
    if (parentCode !== undefined) haystack.push(parentCode)
    const childSessionId = generation.child.sessionId
    if (childSessionId !== undefined) {
      const childCode = codes.session.get(childSessionId)
      if (childCode !== undefined) haystack.push(childCode)
    }
  }
  return haystack.some(value => value.toLowerCase().includes(needle))
}

/** Display codes for everything one snapshot can show, resolved once per render. */
export interface HandleCodes {
  readonly locus: ReadonlyMap<string, string>
  readonly session: ReadonlyMap<string, string>
  readonly endpoint: ReadonlyMap<string, string>
  readonly workspace: ReadonlyMap<string, string>
}

/**
 * Resolve every display code the surface needs from one snapshot.
 *
 * One pass over the whole snapshot matters: codes are collision-resolved across
 * the set that is actually on screen, so computing them per row would let two
 * rows pick the same alias.
 * @param snapshot - Complete management snapshot.
 * @returns the codes, keyed by the identifier each was derived from.
 */
export function collectHandleCodes(snapshot: PetLocusManagementView): HandleCodes {
  const locusIds: string[] = []
  const sessionIds: string[] = []
  const endpointIds: string[] = []
  const workspaceIds: string[] = []
  for (const record of snapshot.loci) {
    locusIds.push(record.locusId)
    sessionIds.push(record.main.sessionId)
    if (record.child.sessionId !== undefined) sessionIds.push(record.child.sessionId)
    endpointIds.push(endpointHandleId(record.endpoint))
    workspaceIds.push(record.workspace.workspaceId)
  }
  return {
    locus: assignHandleCodes(locusIds, 'locus'),
    session: assignHandleCodes(sessionIds, 'session'),
    endpoint: assignHandleCodes(endpointIds, 'endpoint'),
    workspace: assignHandleCodes(workspaceIds, 'workspace'),
  }
}

// ---------------------------------------------------------------------------
// Execution-root confirmation
// ---------------------------------------------------------------------------

/**
 * Whether the owner still has to confirm an execution root for this locus.
 *
 * Keyed on the ROOT, not on the anchor's status. An anchor can be `confirmed`
 * while carrying no `executionRoot` (confirming context facts is a separate
 * act), and the write gate needs the root specifically — so hiding the action
 * on `status === 'confirmed'` removed the only way to ever supply it.
 *
 * @param locus - One locus view from the Host snapshot.
 * @returns true while a root still has to be confirmed.
 */
export function locusNeedsExecutionRoot(locus: PetLocusView): boolean {
  const confirmed = locus.contextAnchor?.executionRoot?.trim()
  return confirmed === undefined || confirmed === ''
}

/**
 * The execution root the owner may confirm: the Host's own resolved candidate.
 *
 * Never invented here. An absent candidate means the action is unavailable and
 * says why, rather than recording a path nobody proved.
 *
 * @param locus - One locus view from the Host snapshot.
 * @returns the candidate path, or `undefined` when the Host resolved none.
 */
export function locusConfirmCandidate(locus: PetLocusView): string | undefined {
  const candidate = locus.workspace.executionRoot?.trim()
  return candidate === undefined || candidate === '' ? undefined : candidate
}

/**
 * The one anchor-confirmation payload for a locus.
 *
 * Built here, as a pure function of the view, so the execution root cannot be
 * dropped by a component edit without failing a test: the previous inline
 * literal in the surface sent the fence plus two empty arrays and no root at
 * all, which marked the anchor confirmed while satisfying neither half of the
 * write gate. The candidate is carried as INTENT only — authority is still
 * derived per verification against the live sandbox root.
 *
 * @param locus - One locus view from the Host snapshot.
 * @returns the `confirm-anchor` request body.
 */
export function locusAnchorConfirmRequest(locus: PetLocusView): PetLocusConfirmAnchorAction {
  const candidate = locusConfirmCandidate(locus)
  return {
    action: 'confirm-anchor',
    locusId: locus.locusId,
    expectedGeneration: locus.generation,
    expectedLocusId: locus.locusId,
    expectedUpdatedAt: locus.state.updatedAt,
    endpoint: {
      chatId: locus.endpoint.chatId,
      ...(locus.endpoint.threadId === undefined ? {} : { threadId: locus.endpoint.threadId }),
    },
    projectResources: [],
    constraints: [],
    existence: 'unknown',
    ...(candidate === undefined ? {} : { executionRoot: candidate }),
  }
}
