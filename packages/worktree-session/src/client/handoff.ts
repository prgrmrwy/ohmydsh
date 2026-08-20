import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HandoffResult, PreparedOperationResult, StartOperationRequest } from '../wire.ts'
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

async function runHandoff(ctx: ClientContext, sourceSessionId: string, cwd: string, mode: SubmitMode | undefined, decoration: Decoration): Promise<void> {
  const stage = getStage(sourceSessionId, cwd)
  if (!stage.enabled || stage.baseRef === undefined) { decoration.original.call(decoration.input, mode); return }
  try {
    setStage(sourceSessionId, cwd, { phase: 'validating', error: undefined })
    const snapshot = preflight(ctx, decoration.input)
    const id = stage.operationId ?? operationId()
    setStage(sourceSessionId, cwd, { operationId: id, phase: 'host' })
    const request: StartOperationRequest = { operationId: id, repoPath: cwd, baseRef: stage.baseRef, taskText: snapshot.text, dependencyMode: 'lean' }
    const prepared = await post<PreparedOperationResult>(ROUTES.start, request)
    setStage(sourceSessionId, cwd, { phase: prepared.phase })
    setStage(sourceSessionId, cwd, { phase: 'workspace' })
    const workspace = await ctx.workspaces.create({ path: prepared.worktreePath })
    const targetId = await ctx.workspaces.connectWorkspace(workspace.workspaceId)
    const targetSessionId = targetId as string
    await post<HandoffResult>(ROUTES.handoff, { operationId: id, repoPath: cwd, action: 'bind-target', targetSessionId })
    setStage(sourceSessionId, cwd, { targetSessionId })
    const targetSummary = summary(ctx, targetSessionId)
    if (targetSummary?.blank === false) {
      await post<HandoffResult>(ROUTES.handoff, { operationId: id, repoPath: cwd, action: 'admitted', targetSessionId })
      ctx.sessions.open(targetId)
      setStage(sourceSessionId, cwd, { phase: 'done', submitted: true, enabled: false })
      decoration.restore()
      return
    }
    if (getStage(sourceSessionId, cwd).submitted) {
      ctx.sessions.open(targetId)
      setStage(sourceSessionId, cwd, { phase: 'uncertain', error: 'Target submit was already attempted; review the target Session before retrying' })
      return
    }
    const targetScope = ctx.sessions.scope(targetId)
    if (targetScope === undefined) throw new Error('Target Session scope is unavailable')
    const target = ctx.conversation.input.for(targetScope)
    setStage(sourceSessionId, cwd, { phase: 'transfer' })
    if (snapshot.imageIds.length > 0 && !target.addImages(snapshot.imageIds)) throw new Error('Target Session refused draft images')
    target.setDraft(snapshot.text)
    ctx.sessions.open(targetId)
    const claim = await post<HandoffResult>(ROUTES.handoff, { operationId: id, repoPath: cwd, action: 'claim-submit', targetSessionId })
    if (!claim.submitAllowed) {
      ctx.sessions.open(targetId)
      setStage(sourceSessionId, cwd, { phase: 'uncertain', submitted: true, error: 'Target submit was already claimed durably; review the target Session before retrying' })
      decoration.restore()
      return
    }
    setStage(sourceSessionId, cwd, { phase: 'submit', submitted: true })
    target.submit(mode)
    if (!(await waitForAdmission(ctx, targetSessionId))) {
      await post<HandoffResult>(ROUTES.handoff, { operationId: id, repoPath: cwd, action: 'uncertain', targetSessionId })
      setStage(sourceSessionId, cwd, { phase: 'uncertain', error: 'Target admission is uncertain; the target draft is preserved and will not be auto-submitted again' })
      decoration.restore()
      return
    }
    await post<HandoffResult>(ROUTES.handoff, { operationId: id, repoPath: cwd, action: 'admitted', targetSessionId })
    decoration.input.setDraft('')
    for (const imageId of snapshot.imageIds) decoration.input.removeImage(imageId)
    setStage(sourceSessionId, cwd, { phase: 'done', enabled: false, error: undefined })
    decoration.restore()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    decoration.input.notify('error', `Worktree Session: ${message}`)
    setStage(sourceSessionId, cwd, { phase: 'error', error: message })
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
    const stage = getStage(sessionId, cwd)
    if (!stage.enabled) { original.call(input, mode); return }
    if (decoration.flight !== undefined) return
    decoration.flight = runHandoff(ctx, sessionId, cwd, mode, decoration).finally(() => { decoration.flight = undefined })
  }
  Object.defineProperty(input, 'submit', { configurable: true, enumerable: ownDescriptor?.enumerable ?? false, writable: true, value: decoration.wrapper })
  decorations.set(sessionId, decoration)
  return decoration.restore
}

export function restoreSubmit(sessionId: string): void { decorations.get(sessionId)?.restore() }
export function restoreAllSubmits(): void { for (const decoration of [...decorations.values()]) decoration.restore() }
