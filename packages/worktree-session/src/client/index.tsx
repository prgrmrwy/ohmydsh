import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { WorktreeControls } from './controls.tsx'
import { restoreAllSubmits } from './handoff.ts'

export const inject = ['slots', 'sessions', 'conversation']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'worktree-session',
    order: 90,
    label: 'Worktree Session',
  }, props => createElement(WorktreeControls, { ...props, pluginContext: ctx })))
  ctx.effect(() => restoreAllSubmits, 'worktree-session: restore submit decorations')
}
