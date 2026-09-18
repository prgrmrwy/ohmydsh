import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: ctx.slots (0.1.2: dsh-client-ui-renderer) and ctx.sessions
// (dsh-api-session-controller) Context merges.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { WorktreeControls, openWorktreeInEditor } from './controls.tsx'
import { restoreAllSubmits } from './handoff.ts'
import { WORKTREE_OPEN_HANDLER_SERVICE, createWorktreeOpenHandlerRegistry } from '../open-handler.ts'

export const inject = ['slots', 'sessions', 'conversation']

export function apply(ctx: ClientContext): void {
  // This is an extension point owned by Worktree Session, not a dependency on
  // any adapter. Keep optional adapters OUT of `inject`: an unresolved inject
  // makes the entire client plugin silently fail to load. ctx.provide owns the
  // registry for this fiber and unregisters it automatically on unload.
  const openHandlers = createWorktreeOpenHandlerRegistry(openWorktreeInEditor)
  ctx.provide(WORKTREE_OPEN_HANDLER_SERVICE, openHandlers)

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'worktree-session',
    order: 90,
    label: 'Worktree Session',
  }, props => createElement(WorktreeControls, {
    ...props,
    pluginContext: ctx,
    openWorktree: path => { openHandlers.open(path) },
  })))
  ctx.effect(() => restoreAllSubmits, 'worktree-session: restore submit decorations')
}
