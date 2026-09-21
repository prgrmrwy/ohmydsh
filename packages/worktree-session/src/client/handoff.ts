import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationController, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
  /** In-flight preparation/binding/submission, cleared when the handoff settles. */
  flight?: Promise<void> | undefined
  restore(): void
}

const decorations = new Map<string, Decoration>()

function operationId(): string {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Freeze the official input machine's current payload before any Host side
 * effects. The source input remains the owner of both text and attachments;
 * Worktree only carries the immutable draft attachment identifiers.
 */
function preflight(ctx: ClientContext, input: InputFacade): { text: string; attachmentIds: readonly DraftAttachmentId[] } {
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain' || state.claim !== undefined) throw new Error('Worktree start requires plain input with no active slash command')
  if (state.draft.trim() === '' && state.attachmentIds.length === 0) throw new Error('Enter a task before starting a Worktree Session')
  if (state.occurrences.length > 0) throw new Error('Remove @ references before starting a Worktree Session')

  const attachmentIds = [...state.attachmentIds]
  const controller = ctx.conversation as unknown as Pick<ConversationController, 'resolveDraftAttachments'>
  let resolved: readonly unknown[]
  try {
    resolved = controller.resolveDraftAttachments(attachmentIds)
  } catch {
    throw new Error('One or more draft attachments are no longer available')
  }
  if (resolved.length !== attachmentIds.length) throw new Error('One or more draft attachments are no longer available')
  return { text: state.draft, attachmentIds }
}

async function bindSource(operationId: string, repoPath: string, sourceSessionId: string): Promise<BindSourceResult> {
  return post<BindSourceResult>(ROUTES.bindSource, { operationId, repoPath, sourceSessionId, action: 'bind-source' })
}

async function runHandoff(ctx: ClientContext, sourceSessionId: string, cwd: string, mode: SubmitMode | undefined, decoration: Decoration): Promise<void> {
  const stage = getStage(sourceSessionId, cwd)
  if (!stage.enabled || stage.baseRef === undefined) { decoration.original.call(decoration.input, mode); return }

  let id = stage.operationId
  try {
    setStage(sourceSessionId, cwd, { phase: 'validating', error: undefined })
    const snapshot = preflight(ctx, decoration.input)
    id ??= operationId()
    setStage(sourceSessionId, cwd, { operationId: id, phase: 'host' })
    const request: StartOperationRequest = {
      operationId: id,
      repoPath: cwd,
      baseRef: stage.baseRef,
      taskText: snapshot.text,
      dependencyMode: 'lean',
    }
    const prepared = await post<PreparedOperationResult>(ROUTES.start, request)
    setStage(sourceSessionId, cwd, {
      phase: 'binding',
      taskBranch: prepared.taskBranch,
      worktreePath: prepared.worktreePath,
      dependencyMode: prepared.dependencyMode,
      packageManager: prepared.packageManager,
    })
    const bound = await bindSource(id, cwd, sourceSessionId)

    // The official SessionInput now owns attempt, receipt, upload/retry, echo
    // retirement, and draft restoration. There is no plugin claim/admission
    // step between binding and the one official submit invocation.
    setStage(sourceSessionId, cwd, {
      lifecycle: bound.state,
      phase: 'handoff-issued',
      enabled: false,
      error: undefined,
    })
    try {
      decoration.original.call(decoration.input, mode)
    } catch (error) {
      // A synchronous official throw leaves the official draft untouched. Do
      // not copy or restore any plugin snapshot; only report the failure and
      // release our decoration so the native input remains usable.
      decoration.restore()
      const message = error instanceof Error ? error.message : String(error)
      setStage(sourceSessionId, cwd, { phase: 'error', lifecycle: bound.state, enabled: false, error: message })
      decoration.input.notify('error', `Worktree Session: ${message}`)
      return
    }

    // Restore immediately after invoking the official submit. Any asynchronous
    // attachment lifecycle continues entirely inside DSH's input/controller.
    decoration.restore()
    setStage(sourceSessionId, cwd, { phase: 'done', lifecycle: bound.state, enabled: false, error: undefined })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStage(sourceSessionId, cwd, { phase: 'error', error: message })
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
  const decoration: Decoration = {
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
  }
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
