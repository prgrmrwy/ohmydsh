/**
 * Open a produced file as a workbench editor tab — the exact effect the
 * sidebar's file tab has when you click a file: `openTab({ type: 'editor',
 * path, id: 'editor:<abs>' })`, so the editor descriptor's per-path dedupe
 * applies and multiple files coexist side by side. Relative paths resolve
 * against the session workspace (the path the tool operated on is often
 * cwd-relative).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: ctx.sessions Context merge (0.1.2: dsh-api-session-controller).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { BetterSidebarService } from './better-sidebar.js'

/** Resolve a (possibly cwd-relative) produced path against the session cwd. */
export function resolveProducedPath(cwd: string | undefined, path: string): string {
  if (!cwd) return path
  if (path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:[\\/]/.test(path)) return path
  return `${cwd.replace(/\/+$/, '')}/${path}`
}

/** Last path segment (both separators accepted), for the editor tab title. */
export function basenameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Open one produced file in the sidebar editor (never throws; degraded = no-op). */
export function openProducedInEditor(
  ctx: Context & { betterSidebar?: BetterSidebarService },
  sessionId: SessionId,
  path: string,
): void {
  const cwd = (ctx.sessions?.list.getSnapshot().byId[sessionId] as { cwd?: string } | undefined)?.cwd
  const absolute = resolveProducedPath(cwd, path)
  ctx.betterSidebar?.openTab({
    type: 'editor',
    title: basenameOf(absolute),
    path: absolute,
    id: `editor:${absolute}`,
  })
}