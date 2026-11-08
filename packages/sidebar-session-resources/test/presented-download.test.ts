// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { PresentedDownload, registerPresentedDownloads } from '../src/client/PresentedDownload.js'
import { pathForPresentedAction } from '../src/client/presented-file.js'
import { inject } from '../src/client/index.js'

const route = (id = 'a', seq = 42, index = 3) => `api/present.open?sessionId=${id}&seq=${seq}&index=${index}`
const snapshot = (files = [
  { seq: 42, index: 3, path: '/remote/a/报告 #100%.docx' },
  { seq: 42, index: 0, path: '/remote/b/报告 #100%.docx' },
]) => ({ timeline: { turns: new Map([[1, { data: { get: () => ({ presented: files }) } }]]) } }) as unknown as ChatSnapshot
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Blob', NodeBlob)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

function fixture() {
  const files = {
    readBytes: vi.fn().mockResolvedValue({ ok: true, value: { absolutePath: '/remote/a/报告 #100%.docx', offset: 0, eof: true, data: new Uint8Array([0, 255, 128]) } }),
  }
  const actions = { save: vi.fn().mockResolvedValue({ status: 'requested' }) }
  const notify = vi.fn()
  const preview = vi.fn()
  const nativeAction = vi.fn()
  const ctx = { get: (key: string) => {
    if (!inject.includes(key)) throw new Error(`cannot get service ${key} without inject`)
    if (key === 'remote') return Object.defineProperty({}, 'workspaceFiles', { get: () => {
      if (!inject.includes('remote.workspaceFiles')) throw new Error('cannot get property remote.workspaceFiles without inject')
      return { ...files }
    } })
    return key === 'fileActions' ? actions : key === 'contextMenus' ? { notify } : undefined
  } } as unknown as Context
  const render = async (id = 'a', actionUrl = route(id), pending = false) => {
    await act(async () => {
      root.render(h('div', { onClick: preview }, h(PresentedDownload, {
        key: `${id}:${actionUrl}`, ctx, sessionId: id, actionUrl, available: false, pending,
        onAction: nativeAction, useChat: (selector: (state: ChatSnapshot) => unknown) => selector(snapshot()),
      } as any)))
    })
  }
  const click = async () => { await act(async () => { container.querySelector('button')!.click() }) }
  return { files, actions, notify, preview, nativeAction, ctx, render, click }
}

describe('presented card identity', () => {
  it('uses the exact original event index even after displayed deliveries are filtered or reordered', () => {
    expect(pathForPresentedAction(snapshot(), 'a', route())).toBe('/remote/a/报告 #100%.docx')
    expect(pathForPresentedAction(snapshot(), 'a', route('a', 42, 0))).toBe('/remote/b/报告 #100%.docx')
  })
  it.each([route('other'), route('a', 41), 'api/present.open?sessionId=a&seq=42&index=-1', 'api/present.open?sessionId=a&seq=42&index=1.5', 'api/present.open?sessionId=a&seq=9007199254740992&index=3', 'api/other?sessionId=a&seq=42&index=3'])(
    'refuses a mismatched or malformed declaration: %s', (url) => { expect(pathForPresentedAction(snapshot(), 'a', url)).toBeUndefined() },
  )
})

describe('presented card download action', () => {
  it('works without a Host desktop and downloads exact bytes without opening the preview or a native application', async () => {
    const { render, click, files, actions, notify, preview, nativeAction } = fixture()
    await render()
    expect(container.querySelector('button')?.disabled).toBe(false)
    expect(container.querySelector('button')?.getAttribute('title')).toBe('下载到本地')
    await click()
    expect(files.readBytes.mock.calls[0]?.slice(0, 3)).toEqual(['a', '/remote/a/报告 #100%.docx', {}])
    const [source, mode] = actions.save.mock.calls[0]!
    expect(mode).toBe('download')
    expect(source.name).toBe('报告 #100%.docx')
    expect(new Uint8Array(await (await source.read(new AbortController().signal)).arrayBuffer())).toEqual(new Uint8Array([0, 255, 128]))
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('已请求浏览器下载'), true)
    expect(preview).not.toHaveBeenCalled()
    expect(nativeAction).not.toHaveBeenCalled()
  })

  it('keeps a pending read alive across scoped-proxy renders, blocks duplicates and cancels when the Session changes', async () => {
    const { render, click, files, actions, notify } = fixture()
    let finish!: (value: unknown) => void
    files.readBytes.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await render()
    await click()
    const signal = files.readBytes.mock.calls[0]![3] as AbortSignal
    expect(signal.aborted).toBe(false)
    expect(container.querySelector('button')?.disabled).toBe(true)
    await click()
    expect(files.readBytes).toHaveBeenCalledTimes(1)
    await render('b')
    expect(signal.aborted).toBe(true)
    await act(async () => { finish({ ok: true, value: { absolutePath: '/old/file', offset: 0, eof: true, data: new Uint8Array([1]) } }) })
    expect(actions.save).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('reports a read error and leaves a retryable button without saving error content', async () => {
    const { render, click, files, actions, notify } = fixture()
    files.readBytes.mockResolvedValue({ ok: false, error: { code: 'workspace-file/not-found' } })
    await render()
    await click()
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('不存在'), false)
    expect(container.querySelector('button')?.title).toContain('不存在')
    expect(container.querySelector('button')?.disabled).toBe(false)
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('disables a missing declaration and a pending native gesture', async () => {
    const { render, click, files } = fixture()
    await render('a', route('a', 999))
    expect(container.querySelector('button')?.disabled).toBe(true)
    await click()
    await render('a', route(), true)
    expect(container.querySelector('button')?.disabled).toBe(true)
    await click()
    expect(files.readBytes).not.toHaveBeenCalled()
  })

  it('adds an ordinary list contribution to the official card seat', () => {
    const register = vi.fn()
    const ctx = { slots: { inject: vi.fn((_name, mount) => mount()), register } } as unknown as Context
    registerPresentedDownloads(ctx)
    expect(register.mock.calls[0]?.[0]).toEqual({ name: 'deliverables.file.actions', id: 'sidebar-session-resources:download', order: 90 })
  })
})
