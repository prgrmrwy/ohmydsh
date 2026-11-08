import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { basenameOf, downloadProducedFile, fileErrorMessage, openProducedInEditor, resolveProducedPath, type ProducedFilesRemote } from '../src/client/open-produced.js'

const session = SessionId('session-a')
const path = 'reports/中文 #100%.zip'
const absolute = '/repo/.worktrees/task/reports/中文 #100%.zip'

function fixture() {
  const data = new Uint8Array([0, 255, 128, 13, 10, 65])
  const files = {
    stat: vi.fn().mockResolvedValue({ ok: true, value: { absolutePath: absolute, version: 'v1' } }),
    readBytes: vi.fn().mockResolvedValue({ ok: true, value: { absolutePath: absolute, version: 'v1', offset: 0, eof: true, data } }),
  } satisfies ProducedFilesRemote
  const actions = { canSaveAs: false, copyImage: vi.fn(), save: vi.fn().mockResolvedValue({ status: 'requested' }) }
  const controller = new AbortController()
  return { files, actions, controller, data }
}

describe('Session file paths', () => {
  it('uses the authorizing Session and Host execution root without URL conversion or cwd concatenation', async () => {
    const { files, controller } = fixture()
    expect(await resolveProducedPath(files, session, path, controller.signal)).toBe(absolute)
    expect(files.stat).toHaveBeenCalledWith(session, path, controller.signal)
    for (const native of ['C:\\work\\报告 #%.pdf', '\\\\server\\share\\a b.zip', '/tmp/a%20b#c']) {
      files.stat.mockResolvedValueOnce({ ok: true, value: { absolutePath: native } })
      expect(await resolveProducedPath(files, session, native, controller.signal)).toBe(native)
    }
  })

  it('does not return an old path when a cancelled stat ignores the signal', async () => {
    const { files, controller } = fixture()
    files.stat.mockImplementation(async () => { controller.abort(); return { ok: true, value: { absolutePath: absolute } } })
    await expect(resolveProducedPath(files, session, path, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('opens the Host path and deduplicates editor tabs by the full path', () => {
    const openTab = vi.fn()
    openProducedInEditor({ betterSidebar: { openTab } } as unknown as Context, absolute)
    expect(openTab).toHaveBeenCalledWith({ type: 'editor', title: '中文 #100%.zip', path: absolute, id: `editor:${absolute}` })
  })
})

describe('original-byte download', () => {
  it('passes intact binary content and Host basename to the official download owner', async () => {
    const { files, actions, controller, data } = fixture()
    expect(await downloadProducedFile(files, actions, session, path, controller.signal)).toEqual({ status: 'requested' })
    expect(files.readBytes).toHaveBeenCalledWith(session, path, {}, controller.signal)
    const [source, mode] = actions.save.mock.calls[0]!
    expect(mode).toBe('download')
    expect(source.name).toBe('中文 #100%.zip')
    const blob: Blob = await source.read(new AbortController().signal)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data)
  })

  it.each(['workspace-file/not-found', 'workspace-file/not-regular-file', 'workspace-file/too-large', 'fs/permission-denied'])(
    'never requests a save for %s', async (code) => {
      const { files, actions, controller } = fixture()
      files.readBytes.mockResolvedValue({ ok: false, error: { code, message: 'read denied', details: { limit: 33554432 } } })
      await expect(downloadProducedFile(files, actions, session, path, controller.signal)).rejects.toThrow()
      expect(actions.save).not.toHaveBeenCalled()
    },
  )

  it('refuses incomplete data and range fragments', async () => {
    const { files, actions, controller } = fixture()
    for (const fragment of [{ offset: 0, eof: false }, { offset: 3, eof: true }]) {
      files.readBytes.mockResolvedValue({ ok: true, value: { ...fragment, absolutePath: absolute, data: new Uint8Array([1]) } })
      await expect(downloadProducedFile(files, actions, session, path, controller.signal)).rejects.toThrow('完整文件')
    }
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('never saves a late read after the Session row is cancelled', async () => {
    const { files, actions, controller } = fixture()
    files.readBytes.mockImplementation(async () => { controller.abort(); return { ok: true, value: { data: new Uint8Array([1]), eof: true } } })
    await expect(downloadProducedFile(files, actions, session, path, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('keeps cancellation effective while the download owner has not yet read its source', async () => {
    const { files, actions, controller } = fixture()
    await downloadProducedFile(files, actions, session, path, controller.signal)
    const [source] = actions.save.mock.calls[0]!
    controller.abort()
    await expect(source.read(new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('file labels', () => {
  it('takes the last segment for either native separator', () => {
    expect(basenameOf('/a/b/c.ts')).toBe('c.ts')
    expect(basenameOf('C:\\a\\b\\c.ts')).toBe('c.ts')
    expect(basenameOf('solo')).toBe('solo')
  })
  it('explains size errors by the official code and limit', () => {
    expect(fileErrorMessage({ code: 'workspace-file/too-large', details: { limit: 33554432 } })).toContain('32 MiB')
  })
})
