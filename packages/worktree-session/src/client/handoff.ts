import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BindSourceResult, PreparedOperationResult, StartOperationRequest } from '../wire.ts'
import { post, ROUTES } from './api.ts'
import { getStage, setStage } from './stage-store.ts'

type SubmitMode = 'queue' | 'steer'
type InputFacade = ReturnType<ClientContext['conversation']['input']['for']>

interface Decoration {
  input: InputFacade
  original: InputFacade['submit']
  ownDescriptor?: PropertyDescriptor
  wrapper: InputFacade['submit']
  flight?: Promise<void>
  restore(): void
}

const decorations = new Map<string, Decoration>()

function operationId(): string {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function summary(ctx: ClientContext, sessionId: string) {
  return ctx.sessions.list.getSnapshot().byId[sessionId as SessionId]
}

async function waitForAdmission(ctx: ClientContext, sessionId: string, timeoutMs = 8_000): Promise<boolean> {
  if (summary(ctx, sessionId)?.blank === false) return true
  return new Promise(resolvePromise => {
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolvePromise(value)
    }
    const unsubscribe = ctx.sessions.list.subscribe(() => {
      if (summary(ctx, sessionId)?.blank === false) finish(true)
    })
    const timer = setTimeout(() => finish(summary(ctx, sessionId)?.blank === false), timeoutMs)
  })
}

function liveImages(ctx: ClientContext, ids: readonly unknown[]): boolean {
  const controller = ctx.conversation as unknown as Pick<ConversationController, 'draftImages'>
  try { return controller.draftImages(ids as never).length === ids.length } catch { return false }
}

function preflight(ctx: ClientContext, input: InputFacade): { text: string; imageIds: readonly never[] } {
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain' || state.claim !== undefined) throw new Error('Worktree start requires plain input with no active slash command')
  if (state.draft.trim() === '' && state.imageIds.length === 0) throw new Error('Enter a task before starting a Worktree Session')
  if (state.occurrences.length > 0) throw new Error('Remove @ references before starting a Worktree Session')
  if (!liveImages(ctx, state.imageIds)) throw new Error('One or more draft images are no longer available')
  return { text: state.draft, imageIds: state.imageIds as readonly never[] }
}

/** Restore only content consumed by the official source submit on uncertain admission. */
function restoreSnapshot(input: InputFacade, snapshot: { text: string; imageIds: readonly never[] }): void {
  const current = input.state.getSnapshot()
  if (current.draft === '') input.setDraft(snapshot.text)
  const present = new Set(current.imageIds)
  const missing = snapshot.imageIds.filter(id => !present.has(id))
  if (missing.length > 0) input.addImages(missing)
}

async function bindingAction(operationId: string, repoPath: string, sourceSessionId: string, action: 'bind-source' | 'claim-submit' | 'admitted' | 'uncertain'): Promise<BindSourceResult> {
  return post<BindSourceResult>(ROUTES.bindSource, { operationId, repoPath, sourceSessionId, action })
}

async function runHandoff(ctx: ClientContext, sourceSessionId: string, cwd: string, mode: SubmitMode | undefined, decoration: Decoration): Promise<void> {
  const stage = getStage(sourceSessionId, cwd)
  if (!stage.enabled || stage.baseRef === undefined) { decoration.original.call(decoration.input, mode); return }
  let claimed = false
  let snapshot: ReturnType<typeof preflight> | undefined
  let id = stage.operationId
  try {
    setStage(sourceSessionId, cwd, { phase: 'validating', error: undefined })
    snapshot = preflight(ctx, decoration.input)
    id ??= operationId()
    setStage(sourceSessionId, cwd, { operationId: id, phase: 'host' })
    const request: StartOperationRequest = { operationId: id, repoPath: cwd, baseRef: stage.baseRef, taskText: snapshot.text, dependencyMode: 'lean' }
    const prepared = await post<PreparedOperationResult>(ROUTES.start, request)
    setStage(sourceSessionId, cwd, { phase: 'binding', taskBranch: prepared.taskBranch, worktreePath: prepared.worktreePath, dependencyMode: prepared.dependencyMode })
    const bound = await bindingAction(id, cwd, sourceSessionId, 'bind-source')
    setStage(sourceSessionId, cwd, { lifecycle: bound.state })

    setStage(sourceSessionId, cwd, { phase: 'claim' })
    const claim = await bindingAction(id, cwd, sourceSessionId, 'claim-submit')
    if (!claim.submitAllowed) {
      setStage(sourceSessionId, cwd, { phase: 'uncertain', lifecycle: claim.state, submitted: true, error: 'Source submit was already claimed durably; inspect this Session before retrying' })
      decoration.restore()
      return
    }

    claimed = true
    setStage(sourceSessionId, cwd, { phase: 'submit', lifecycle: claim.state, submitted: true })
    decoration.original.call(decoration.input, mode)
    if (!(await waitForAdmission(ctx, sourceSessionId))) {
      await bindingAction(id, cwd, sourceSessionId, 'uncertain')
      restoreSnapshot(decoration.input, snapshot)
      setStage(sourceSessionId, cwd, { phase: 'uncertain', lifecycle: 'uncertain', error: 'Source admission is uncertain; the draft is preserved and will not be auto-submitted again' })
      decoration.restore()
      return
    }

    await bindingAction(id, cwd, sourceSessionId, 'admitted')
    setStage(sourceSessionId, cwd, { phase: 'done', lifecycle: 'admitted', enabled: false, error: undefined })
    decoration.restore()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (claimed && id !== undefined) {
      try { await bindingAction(id, cwd, sourceSessionId, 'uncertain') } catch { /* preserve the primary error */ }
      if (snapshot !== undefined) restoreSnapshot(decoration.input, snapshot)
      setStage(sourceSessionId, cwd, { phase: 'uncertain', lifecycle: 'uncertain', submitted: true, error: message })
    } else {
      setStage(sourceSessionId, cwd, { phase: 'error', error: message })
    }
    decoration.input.notify('error', `Worktree Session: ${message}`)
  }
}

export function decorateSubmit(ctx: ClientContext, sessionId: string, cwd: string): () => void {
  const existing = decorations.get(sessionId)
  if (existing !== undefined) return existing.restore
  const scope = ctx.sessions.scope(sessionId as SessionId)
  if (scope === undefined) throw new Error('Source Session scope is unavailable')
  const input = ctx.conversation.input.for(scope)
  const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'submit')
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input) as object, 'submit')
  if ((ownDescriptor !== undefined && ownDescriptor.writable === false) || (ownDescriptor === undefined && !Object.isExtensible(input)) || prototypeDescriptor?.writable === false) {
    throw new Error('SessionInput.submit is not compatible with Worktree Session')
  }
  const original = input.submit
  const decoration = {
    input,
    original,
    ...(ownDescriptor === undefined ? {} : { ownDescriptor }),
    wrapper: (() => {}) as InputFacade['submit'],
    restore() {
      if (decorations.get(sessionId) !== decoration) return
      if (decoration.ownDescriptor === undefined) delete (input as unknown as { submit?: unknown }).submit
      else Object.defineProperty(input, 'submit', decoration.ownDescriptor)
      decorations.delete(sessionId)
    },
  } satisfies Decoration
  decoration.wrapper = function submit(mode?: SubmitMode): void {
    const current = getStage(sessionId, cwd)
    if (!current.enabled) { original.call(input, mode); return }
    if (decoration.flight !== undefined) return
    decoration.flight = runHandoff(ctx, sessionId, cwd, mode, decoration).finally(() => { decoration.flight = undefined })
  }
  Object.defineProperty(input, 'submit', { configurable: true, enumerable: ownDescriptor?.enumerable ?? false, writable: true, value: decoration.wrapper })
  decorations.set(sessionId, decoration)
  return decoration.restore
}

export function restoreSubmit(sessionId: string): void { decorations.get(sessionId)?.restore() }
export function restoreAllSubmits(): void { for (const decoration of [...decorations.values()]) decoration.restore() }
