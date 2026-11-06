/**
 * Pure presentation model for the v20 locus management surface
 * (pet-locus-isomorphic-entries D10).
 *
 * Everything here is a function of the Host snapshot
 * (`PetLocusManagementViewV20`): no fetch, no React, no storage. It derives
 * labels, groupings, filter buckets, gating reasons and request bodies only;
 * every fact (state, availability, in-flight, the write switch) comes from the
 * Host, and short codes are display aliases never accepted as input.
 */

import type {
  PetLocusAccessActionV20,
  PetLocusAccessModeV20,
  PetLocusChatViewV20,
  PetLocusEndpointView,
  PetLocusEntryViewV20,
  PetLocusManagementViewV20,
  PetLocusRebindActionV20,
  PetLocusStateV20,
  PetLocusStopActionV20,
  PetLocusWorkViewV20,
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
      // Document root `doc:docx:<token>`: the token (D14).
      if (trimmed.startsWith(DOC_ROOT_PREFIX)) return trimmed.slice(DOC_ROOT_PREFIX.length)
      // Comment `cmt:<comment_id>` (see endpointHandleId): comment ids are
      // time-ordered digits sharing long prefixes, so the source is REVERSED
      // and a short code lands on the distinguishing tail.
      if (trimmed.startsWith(COMMENT_HANDLE_PREFIX)) return [...trimmed.slice(COMMENT_HANDLE_PREFIX.length)].reverse().join('')
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

/** The labelled code for an endpoint: `oc`/`omt` as the platform does, `doc`/`cmt` for documents. */
export function endpointHandleLabel(endpoint: PetLocusEndpointView, code: string): string {
  if (code === '') return ''
  if (isDocEndpointView(endpoint)) return `${endpoint.threadId === undefined ? 'doc' : 'cmt'}·${code}`
  return `${endpoint.threadId === undefined ? 'oc' : 'omt'}·${code}`
}

/** The identifier a locus's short code is derived from. */
export function locusHandleId(locus: Pick<PetLocusEntryViewV20, 'locusId'>): string {
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
  // A comment id is bare digits; tag it so its code is derived by the comment
  // rule and never collides with an IM thread id's map key.
  if (isDocEndpointView(endpoint) && endpoint.threadId !== undefined) return `${COMMENT_HANDLE_PREFIX}${endpoint.threadId}`
  return endpoint.threadId ?? endpoint.chatId
}

/** Document-root prefix, mirrored from the Host's doc-endpoint module (D4). */
const DOC_ROOT_PREFIX = 'doc:docx:'
/** Display-only tag for a comment id's short-code source. */
const COMMENT_HANDLE_PREFIX = 'cmt:'

/** Whether an endpoint is a document entry (root or comment). */
export function isDocEndpointView(endpoint: Pick<PetLocusEndpointView, 'chatId'>): boolean {
  return endpoint.chatId.startsWith('doc:')
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
  if (isDocEndpointView(endpoint)) {
    return endpoint.threadId === undefined ? { label: '文档', isTopic: false } : { label: '评论', isTopic: true }
  }
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
  // A comment entry is named by its quote summary (D14); never a token.
  const quote = isDocEndpointView(endpoint) && endpoint.threadId !== undefined ? endpoint.quote?.trim() ?? '' : ''
  if (quote !== '') return { name: `「${quote.length > 24 ? `${quote.slice(0, 24)}…` : quote}」`, isPlaceholder: false, role }
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

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Owner-facing names for exactly the four v20 states. */
export const LOCUS_STATE_LABELS: Record<PetLocusStateV20, string> = {
  'not-created': '未创建',
  active: '活跃',
  invalid: '已失效',
  stopped: '已停止',
}

/** Whether a Host-reported state is one of the four v20 values. */
export function isKnownLocusState(state: string): state is PetLocusStateV20 {
  return Object.prototype.hasOwnProperty.call(LOCUS_STATE_LABELS, state)
}

/**
 * The label for one state. A value outside the four (a removed `retired` or
 * `provisioning`, or anything new) reads 「未知状态」, never blank and never
 * active.
 */
export function locusStateLabel(state: string): string {
  return isKnownLocusState(state) ? LOCUS_STATE_LABELS[state] : '未知状态'
}

/** Colours are a second channel only: every state also has a word. */
export type LocusTone = 'on' | 'warn' | 'off' | 'gone'

const LOCUS_STATE_TONES: Record<PetLocusStateV20, LocusTone> = {
  active: 'on',
  'not-created': 'on',
  stopped: 'warn',
  invalid: 'off',
}

export function locusStateTone(state: string): LocusTone {
  return isKnownLocusState(state) ? LOCUS_STATE_TONES[state] : 'gone'
}

/** The one access value, as the owner reads it. */
export const LOCUS_ACCESS_LABELS: Record<PetLocusAccessModeV20, string> = {
  'read-only': '只读',
  'danger-full-access': '完全访问',
}

/** Shown wherever full access is in effect (spec 访问模式以单值呈现). */
export const LOCUS_FULL_ACCESS_NOTE =
  '整机无边界、入口成员共享：可在本机执行命令、使用本机飞书凭据；出站 guard 仅防误操作，不是安全边界'

type SessionAvailability = 'available' | 'archived' | 'missing' | 'unknown' | undefined

/** Owner-facing label for a session availability value. */
export function sessionAvailabilityLabel(availability: SessionAvailability): string {
  if (availability === 'available') return '可用'
  if (availability === 'archived') return '已归档'
  if (availability === 'missing') return '不可用'
  return '未核验'
}

/**
 * Why a session jump is unavailable, or undefined when it is available.
 * `unknown` is a cold read that proved nothing: it fails closed.
 */
export function sessionJumpBlock(availability: SessionAvailability): string | undefined {
  if (availability === 'archived') return '会话已归档，无法打开'
  if (availability === 'missing') return '会话不可用，无法打开'
  if (availability === 'unknown') return '会话可用性未核验，无法打开'
  return undefined
}

/** The text that stands for the child session of a not-created entry. */
export const LOCUS_NOT_CREATED_SESSION = '尚未创建'

/** The child-session jump: a not-created entry has no session yet. */
export function childJumpBlock(entry: PetLocusEntryViewV20): string | undefined {
  if (entry.state === 'not-created') return LOCUS_NOT_CREATED_SESSION
  return sessionJumpBlock(entry.session?.availability ?? 'unknown')
}

// ---------------------------------------------------------------------------
// Owner notes and gating (design D10)
// ---------------------------------------------------------------------------

export const LOCUS_INVALID_NOTE = '下一条授权 @ 时自动重建'
export const LOCUS_STOPPED_NOTE = '在该入口对同一来源会话重新 /bind 可重新启用'
export const LOCUS_ARCHIVED_W_NOTE = '来源会话已归档，可改绑'
export const LOCUS_DEFAULT_QA_MISSING_NOTE =
  '默认 Q&A 尚未创建，请在目标会话中通过 Pet 轮盘的「答疑群」创建；管理面只做展示与导航，不提供创建入口。'
/** What a stale fence refusal reads as (spec 围栏过期时拒绝而不乐观改写). */
export const LOCUS_FENCE_STALE_TEXT = '入口已变化，请刷新后重试'

export const LOCUS_REBIND_UNARCHIVED_REASON = '当前来源会话未归档，仅在其归档后可改绑'
export const LOCUS_REBIND_BUSY_REASON = '该群有入口正在投递，待其结束后再改绑'
export const LOCUS_STOP_BUSY_REASON = '该入口正在投递，待其结束后再停止'
export const LOCUS_ACCESS_BUSY_REASON = '该入口正在投递，待其结束后再修改访问模式'
export const LOCUS_ACCESS_STATE_REASON = '只有未创建或活跃的入口可以修改访问模式'
export const LOCUS_WRITE_DISABLED_REASON = '写档已全局停用（全局写开关已关闭）'
export const LOCUS_REBIND_CONSEQUENCES =
  '改绑后各入口在新会话下按首条消息重新创建子会话，不保留上下文；不迁移协作条目，不归档旧子会话，不向群里发通知。已停止的入口保持停止。'

/** The in-place note an entry row carries for its own state. */
export function entryStateNote(entry: PetLocusEntryViewV20): string | undefined {
  if (entry.state === 'invalid') return LOCUS_INVALID_NOTE
  if (entry.state === 'stopped') return LOCUS_STOPPED_NOTE
  return undefined
}

/** A group row of an archived W asks for a rebind; nothing else does. */
export function archivedWorkNote(work: PetLocusWorkViewV20): string | undefined {
  return work.availability === 'archived' ? LOCUS_ARCHIVED_W_NOTE : undefined
}

/**
 * Why 「改绑到其他会话」 is greyed, or undefined when it may be clicked. Only an
 * archived W enables it (an unprovable one does not), and only a CURRENT
 * delivery greys it: backlog is retargeted by the reset, unlike stop / access.
 */
export function rebindBlock(chat: PetLocusChatViewV20, work: PetLocusWorkViewV20): string | undefined {
  if (work.availability !== 'archived') return LOCUS_REBIND_UNARCHIVED_REASON
  if ([chat.group, ...chat.topics].some(entry => entry.hasCurrentDelivery)) return LOCUS_REBIND_BUSY_REASON
  return undefined
}

/** Why 「停止」 is greyed for this entry, or undefined. */
export function stopBlock(entry: PetLocusEntryViewV20): string | undefined {
  if (entry.state === 'stopped') return '入口已停止'
  if (entry.inFlight) return LOCUS_STOP_BUSY_REASON
  return undefined
}

/** Why the access toggle is greyed as a whole for this entry, or undefined. */
export function accessBlock(entry: PetLocusEntryViewV20): string | undefined {
  if (entry.state !== 'not-created' && entry.state !== 'active') return LOCUS_ACCESS_STATE_REASON
  if (entry.inFlight) return LOCUS_ACCESS_BUSY_REASON
  return undefined
}

/** Why 「完全访问」 specifically is greyed: the global write switch. 「只读」 stays selectable. */
export function fullAccessBlock(snapshot: Pick<PetLocusManagementViewV20, 'writeEnabled'>): string | undefined {
  return snapshot.writeEnabled ? undefined : LOCUS_WRITE_DISABLED_REASON
}

// ---------------------------------------------------------------------------
// Request bodies: the fence is {expectedLocusId, expectedRevision}, nothing else
// ---------------------------------------------------------------------------

function endpointInputOf(endpoint: PetLocusEndpointView): { chatId: string; threadId?: string } {
  return endpoint.threadId === undefined ? { chatId: endpoint.chatId } : { chatId: endpoint.chatId, threadId: endpoint.threadId }
}

export function locusStopRequest(entry: PetLocusEntryViewV20): PetLocusStopActionV20 {
  return {
    action: 'stop',
    endpoint: endpointInputOf(entry.endpoint),
    expectedLocusId: entry.locusId,
    expectedRevision: entry.revision,
  }
}

export function locusAccessRequest(entry: PetLocusEntryViewV20, accessMode: PetLocusAccessModeV20): PetLocusAccessActionV20 {
  return {
    action: 'access',
    endpoint: endpointInputOf(entry.endpoint),
    accessMode,
    expectedLocusId: entry.locusId,
    expectedRevision: entry.revision,
  }
}

/** The input is sent as typed (trimmed): a short code is never resolved. The fence is the GROUP row's. */
export function locusRebindRequest(chat: PetLocusChatViewV20, input: string): PetLocusRebindActionV20 {
  return {
    action: 'rebind',
    chatId: chat.group.endpoint.chatId,
    workSessionId: input.trim(),
    expectedLocusId: chat.group.locusId,
    expectedRevision: chat.group.revision,
  }
}

// ---------------------------------------------------------------------------
// Filtering (spec 管理面按工作会话与入口状态筛选)
// ---------------------------------------------------------------------------

export type EntryBucketId = 'serving' | 'down' | 'archived'

export interface EntryBucketOption {
  readonly id: EntryBucketId
  readonly label: string
}

/** Exactly three flat buckets; every recognised entry lands in exactly one. */
export const ENTRY_BUCKET_OPTIONS: readonly EntryBucketOption[] = [
  { id: 'serving', label: '在服务' },
  { id: 'down', label: '已停止 / 已失效' },
  { id: 'archived', label: '已归档' },
]

/**
 * The bucket of one entry. An archived work session wins over the entry's own
 * state: the whole group is the owner's to rebind or leave. `undefined` is an
 * unrecognised state outside an archived W: never filtered, shown as 「未知状态」.
 */
export function entryBucketOf(state: string, work: Pick<PetLocusWorkViewV20, 'availability'>): EntryBucketId | undefined {
  if (work.availability === 'archived') return 'archived'
  if (state === 'not-created' || state === 'active') return 'serving'
  if (state === 'stopped' || state === 'invalid') return 'down'
  return undefined
}

export interface LocusFilter {
  readonly buckets: readonly EntryBucketId[]
}

/** Default: only entries still served by a live work session. */
export const DEFAULT_LOCUS_FILTER: LocusFilter = { buckets: ['serving'] }
export const SHOW_ALL_LOCUS_FILTER: LocusFilter = { buckets: ['serving', 'down', 'archived'] }

/** How the filter reads on its collapsed face: the ticked buckets, in order. */
export function entryStateFilterLabel(filter: LocusFilter): string {
  const selected = new Set(filter.buckets)
  if (ENTRY_BUCKET_OPTIONS.every(option => selected.has(option.id))) return '全部'
  if (selected.size === 0) return '无'
  return ENTRY_BUCKET_OPTIONS.filter(option => selected.has(option.id)).map(option => option.label).join('、')
}

/** One chat as shown: the group row, or only its container when it is filtered out. */
export interface ChatSection {
  readonly key: string
  readonly chat: PetLocusChatViewV20
  /** False: the group row is kept only as the container of visible topics. */
  readonly groupVisible: boolean
  readonly topics: readonly PetLocusEntryViewV20[]
}

export interface WorkSectionView {
  readonly work: PetLocusWorkViewV20
  readonly chats: readonly ChatSection[]
  /** Whether any chat of this W is its default Q&A group (over the whole snapshot). */
  readonly hasDefaultQa: boolean
}

export interface FilteredLocusView {
  readonly works: readonly WorkSectionView[]
}

function narrow(
  snapshot: PetLocusManagementViewV20,
  keep: (entry: PetLocusEntryViewV20, work: PetLocusWorkViewV20) => boolean,
): FilteredLocusView {
  const works: WorkSectionView[] = []
  for (const group of snapshot.works) {
    const chats: ChatSection[] = []
    for (const chat of group.chats) {
      const topics = chat.topics.filter(topic => keep(topic, group.work))
      const groupVisible = keep(chat.group, group.work)
      if (!groupVisible && topics.length === 0) continue
      chats.push({ key: chatKey(chat.group.endpoint), chat, groupVisible, topics })
    }
    if (chats.length === 0) continue
    works.push({ work: group.work, chats, hasDefaultQa: group.chats.some(chat => chat.defaultQa === true) })
  }
  return { works }
}

/** Apply the filter. Pure: the snapshot is never touched. */
export function applyLocusFilter(
  snapshot: PetLocusManagementViewV20,
  filter: LocusFilter = DEFAULT_LOCUS_FILTER,
): FilteredLocusView {
  const buckets = new Set(filter.buckets)
  return narrow(snapshot, (entry, work) => {
    const bucket = entryBucketOf(entry.state, work)
    return bucket === undefined || buckets.has(bucket)
  })
}

/**
 * Counts per bucket over the WHOLE snapshot, including unchecked buckets.
 * An unrecognised state outside an archived W is in no bucket (it is always
 * shown), so it is the only thing the three counts do not add up to.
 */
export function countLocusFilterOptions(snapshot: PetLocusManagementViewV20): ReadonlyMap<EntryBucketId, number> {
  const counts = new Map<EntryBucketId, number>()
  for (const work of snapshot.works) {
    for (const chat of work.chats) {
      for (const entry of [chat.group, ...chat.topics]) {
        const bucket = entryBucketOf(entry.state, work.work)
        if (bucket !== undefined) counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
      }
    }
  }
  return counts
}

export interface LocusSummary {
  readonly entries: number
  readonly chats: number
  readonly works: number
}

/** What a view shows; a container group row is not counted as an entry. */
export function summarizeLocusView(view: FilteredLocusView): LocusSummary {
  let entries = 0
  let chats = 0
  for (const work of view.works) {
    for (const chat of work.chats) {
      chats += 1
      entries += chat.topics.length + (chat.groupVisible ? 1 : 0)
    }
  }
  return { entries, chats, works: view.works.length }
}

// ---------------------------------------------------------------------------
// Display codes and search
// ---------------------------------------------------------------------------

/** Display codes for everything one snapshot can show, resolved once per render. */
export interface HandleCodes {
  readonly locus: ReadonlyMap<string, string>
  readonly session: ReadonlyMap<string, string>
  readonly endpoint: ReadonlyMap<string, string>
  readonly workspace: ReadonlyMap<string, string>
}

/** Resolve every display code in one pass, so collisions resolve across the whole set. */
export function collectHandleCodes(snapshot: PetLocusManagementViewV20): HandleCodes {
  const locusIds: string[] = []
  const sessionIds: string[] = []
  const endpointIds: string[] = []
  const workspaceIds: string[] = []
  for (const group of snapshot.works) {
    sessionIds.push(group.work.sessionId)
    for (const chat of group.chats) {
      sessionIds.push(chat.locusMain.sessionId)
      if (chat.reboundFrom !== undefined) sessionIds.push(chat.reboundFrom.sessionId)
      workspaceIds.push(chat.workspace.workspaceId)
      for (const entry of [chat.group, ...chat.topics]) {
        locusIds.push(entry.locusId)
        sessionIds.push(entry.sessionId)
        endpointIds.push(endpointHandleId(entry.endpoint))
      }
    }
  }
  return {
    locus: assignHandleCodes(locusIds, 'locus'),
    session: assignHandleCodes(sessionIds, 'session'),
    endpoint: assignHandleCodes(endpointIds, 'endpoint'),
    workspace: assignHandleCodes(workspaceIds, 'workspace'),
  }
}

/** Literal match over names, display codes and real ids; nothing fuzzy. */
export function entryMatchesQuery(
  entry: PetLocusEntryViewV20,
  chat: PetLocusChatViewV20,
  work: PetLocusWorkViewV20,
  codes: HandleCodes,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const haystack: string[] = [
    entry.endpoint.chatId, entry.endpoint.threadId ?? '', entry.endpoint.chatName ?? '', entry.endpoint.quote ?? '',
    entry.locusId, entry.sessionId, entry.session?.title ?? '',
    work.sessionId, work.title ?? '', chat.locusMain.sessionId, chat.locusMain.title ?? '',
    codes.endpoint.get(endpointHandleId(entry.endpoint)) ?? '',
    codes.locus.get(entry.locusId) ?? '',
    codes.session.get(entry.sessionId) ?? '',
    codes.session.get(work.sessionId) ?? '',
    codes.session.get(chat.locusMain.sessionId) ?? '',
  ]
  return haystack.some(value => value !== '' && value.toLowerCase().includes(needle))
}

/** Narrow an already filtered view; search never resurrects what the filter hid. */
export function applyQuery(view: FilteredLocusView, codes: HandleCodes, query: string): FilteredLocusView {
  if (query.trim() === '') return view
  const works: WorkSectionView[] = []
  for (const section of view.works) {
    const chats: ChatSection[] = []
    for (const item of section.chats) {
      const topics = item.topics.filter(topic => entryMatchesQuery(topic, item.chat, section.work, codes, query))
      const groupVisible = item.groupVisible && entryMatchesQuery(item.chat.group, item.chat, section.work, codes, query)
      if (!groupVisible && topics.length === 0) continue
      chats.push({ ...item, groupVisible, topics })
    }
    if (chats.length > 0) works.push({ ...section, chats })
  }
  return { works }
}

// ---------------------------------------------------------------------------
// Reading B: by entry
// ---------------------------------------------------------------------------

/** Every chat with the W it serves, from the same view as reading A. */
export function groupByEntry(
  view: FilteredLocusView,
): readonly { readonly work: PetLocusWorkViewV20; readonly section: ChatSection }[] {
  return view.works
    .flatMap(work => work.chats.map(section => ({ work: work.work, section })))
    .sort((left, right) => left.section.key.localeCompare(right.section.key))
}

// ---------------------------------------------------------------------------
// Feishu jumps and empty states
// ---------------------------------------------------------------------------

export type EntryFeishuTarget =
  | { readonly kind: 'thread'; readonly url: string; readonly reason?: undefined }
  | { readonly kind: 'chat'; readonly url?: string; readonly reason?: string }
  | { readonly kind: 'doc'; readonly url?: string; readonly reason?: string }

/**
 * Where an entry's Feishu jump lands. A topic opens its thread; a thread id
 * that is not a proven `omt_` topic id degrades to the chat and says so — the
 * panel never fabricates a topic target. Documents open the inspected URL only.
 */
export function entryFeishuTarget(endpoint: PetLocusEndpointView, chatLink: (chatId: string) => string | undefined): EntryFeishuTarget {
  if (isDocEndpointView(endpoint)) {
    return endpoint.docUrl === undefined ? { kind: 'doc', reason: '文档元数据暂不可读，无法提供链接' } : { kind: 'doc', url: endpoint.docUrl }
  }
  const threadId = endpoint.threadId?.trim()
  const chat = chatLink(endpoint.chatId)
  if (threadId === undefined) return chat === undefined ? { kind: 'chat', reason: '这个入口没有可用的飞书链接' } : { kind: 'chat', url: chat }
  if (threadId.startsWith('omt_')) {
    return { kind: 'thread', url: `https://applink.feishu.cn/client/thread/open?threadId=${encodeURIComponent(threadId)}` }
  }
  return { kind: 'chat', ...(chat === undefined ? {} : { url: chat }), reason: '无法证明话题标识，已退化为所属群' }
}

/** The empty list states the conditions that could be relaxed; it never reads as deleted. */
export function emptyListText(query: string): string {
  return query.trim() !== ''
    ? '没有匹配的关联。清空搜索，或放宽上面的筛选。'
    : '当前筛选下没有关联。可以放宽上面的筛选：勾选「已停止 / 已失效」可看到已停止或已失效的入口，勾选「已归档」可看到来源会话已归档、待改绑的入口。'
}
