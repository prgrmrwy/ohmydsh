/** Session-authorized paths and original-byte downloads for produced files. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { FileActions, FileSaveResult } from '@deepseek-ai/dsh-client-ui-file-actions/client'
import type { BetterSidebarService } from './better-sidebar.js'

export type ProducedFilesRemote = Pick<ClientRemote['workspaceFiles'], 'stat' | 'readBytes'>

/** Last path segment; paths stay native strings, never URL-decoded. */
export function basenameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Human-readable official file failures, without parsing message text. */
export function fileErrorMessage(error: unknown): string {
  const failure = error as { code?: string; message?: string; details?: { limit?: number } } | undefined
  switch (failure?.code) {
    case 'workspace-file/not-found': return '远端文件不存在，可能已移动或删除。'
    case 'workspace-file/not-regular-file': return '只能下载普通文件，目录和符号链接不支持。'
    case 'workspace-file/too-large': {
      const limit = failure.details?.limit
      return typeof limit === 'number'
        ? `文件超过读取上限（${Math.round(limit / 1024 / 1024)} MiB）。`
        : '文件超过官方读取大小上限。'
    }
    default: return failure?.message || '远端文件操作失败，请检查连接与文件权限。'
  }
}

/** The Host owns path resolution, including the Session's execution root. */
export async function resolveProducedPath(
  files: ProducedFilesRemote,
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await files.stat(sessionId, path, signal)
  signal.throwIfAborted()
  if (!result.ok) throw new Error(fileErrorMessage(result.error))
  return result.value.absolutePath
}

/** No text decoding, URL navigation, local-path guessing or new Host file endpoint. */
export async function downloadProducedFile(
  files: ProducedFilesRemote,
  actions: FileActions,
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
): Promise<FileSaveResult> {
  signal.throwIfAborted()
  const result = await files.readBytes(sessionId, path, {}, signal)
  signal.throwIfAborted()
  if (!result.ok) throw new Error(fileErrorMessage(result.error))
  if (!result.value.eof || result.value.offset !== 0) throw new Error('未读取到完整文件，下载已取消。')
  // An invented MIME would make fileActions replace a PDF/ZIP suffix with .bin.
  const blob = new Blob([new Uint8Array(result.value.data)])
  return actions.save({
    url: '',
    name: basenameOf(result.value.absolutePath),
    read: async (saveSignal) => {
      saveSignal.throwIfAborted()
      signal.throwIfAborted()
      return blob
    },
  }, 'download')
}

/** Open the Host-resolved path in the workbench's per-path editor tab. */
export function openProducedInEditor(
  ctx: Context & { betterSidebar?: BetterSidebarService },
  absolutePath: string,
): void {
  if (!ctx.betterSidebar) throw new Error('侧边栏编辑器不可用。')
  ctx.betterSidebar.openTab({
    type: 'editor',
    title: basenameOf(absolutePath),
    path: absolutePath,
    id: `editor:${absolutePath}`,
  })
}
