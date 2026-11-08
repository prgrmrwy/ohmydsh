// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ProducedFileRow } from '../src/client/ProducedFileRow.js'
import { Panel } from '../src/client/Panel.js'
import type { SessionResourcesStore } from '../src/client/collector.js'

const absolute = '/repo/.worktrees/a/reports/报告 #1%.pdf'
const file = { path: 'reports/报告 #1%.pdf', time: 1, seq: 1 }
let root: Root
let container: HTMLDivElement

function fixture() {
  const files = {
    stat: vi.fn().mockResolvedValue({ ok: true, value: { absolutePath: absolute } }),
    readBytes: vi.fn().mockResolvedValue({ ok: true, value: { absolutePath: absolute, offset: 0, eof: true, data: new Uint8Array([0, 255]) } }),
  }
  const actions = { save: vi.fn().mockResolvedValue({ status: 'requested' }) }
  const ctx = { get: (name: string) => name === 'remote' ? { workspaceFiles: { ...files } } : name === 'fileActions' ? actions : undefined } as unknown as Context
  const onOpenFile = vi.fn()
  const render = async (sessionId = 'a') => {
    await act(async () => { root.render(h(ProducedFileRow, { key: sessionId, ctx, sessionId: SessionId(sessionId), file, time: '刚刚', onOpenFile })) })
  }
  return { files, actions, ctx, onOpenFile, render }
}

async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label))!
  await act(async () => { button.click() })
}

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

describe('produced file row', () => {
  it('displays the full remote path and copies/opens the same path, separately from download', async () => {
    const { render, onOpenFile, files } = fixture()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await render()
    expect(container.textContent).toContain(`远端路径：${absolute}`)
    await click('复制路径')
    expect(writeText).toHaveBeenCalledWith(absolute)
    await click('#')
    expect(onOpenFile).toHaveBeenCalledWith(absolute)
    expect(files.readBytes).not.toHaveBeenCalled()
  })

  it('reports requested rather than saved and preserves binary content', async () => {
    const { render, actions, files } = fixture()
    await render()
    await click('下载')
    expect(files.readBytes.mock.calls[0]?.slice(0, 3)).toEqual([SessionId('a'), absolute, {}])
    expect(container.querySelector('[role="status"]')?.textContent).toContain('已请求浏览器下载')
    expect(container.textContent).not.toContain('文件已保存')
    const blob = await actions.save.mock.calls[0]![0].read(new AbortController().signal)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 255]))
  })

  it('retains the recorded path and a useful error when stat fails; download can be retried', async () => {
    const { render, files, actions } = fixture()
    files.stat.mockResolvedValue({ ok: false, error: { code: 'workspace-file/not-found' } })
    files.readBytes.mockResolvedValue({ ok: false, error: { code: 'workspace-file/too-large', details: { limit: 33554432 } } })
    await render()
    expect(container.textContent).toContain(`记录路径：${file.path}`)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('不存在')
    await click('下载')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('32 MiB')
    expect(actions.save).not.toHaveBeenCalled()
    expect([...container.querySelectorAll('button')].find((item) => item.textContent === '下载')?.disabled).toBe(false)
  })

  it('cancels a pending download on Session change, blocks duplicate clicks and ignores late data', async () => {
    const { render, files, actions } = fixture()
    let finish!: (value: unknown) => void
    files.readBytes.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await render()
    await click('下载')
    const signal = files.readBytes.mock.calls[0]![3] as AbortSignal
    expect(signal.aborted).toBe(false)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await click('处理中')
    expect(files.readBytes).toHaveBeenCalledTimes(1)
    await render('b')
    expect(signal.aborted).toBe(true)
    await act(async () => { finish({ ok: true, value: { absolutePath: absolute, offset: 0, eof: true, data: new Uint8Array([1]) } }) })
    expect(actions.save).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('does not let a late stat from the old Session overwrite the new path', async () => {
    const { render, files } = fixture()
    let finish!: (value: unknown) => void
    files.stat.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await render('a')
    const signal = files.stat.mock.calls[0]![2] as AbortSignal
    files.stat.mockResolvedValue({ ok: true, value: { absolutePath: '/workspace-b/report.pdf' } })
    await render('b')
    expect(signal.aborted).toBe(true)
    await act(async () => { finish({ ok: true, value: { absolutePath: absolute } }) })
    expect(container.textContent).toContain('/workspace-b/report.pdf')
    expect(container.textContent).not.toContain(absolute)
  })

  it('the actual Panel cancels old downloads when Sessions share a recorded path', async () => {
    const { files, actions, ctx } = fixture()
    let finish!: (value: unknown) => void
    files.stat.mockImplementation(async (id: string) => ({ ok: true, value: { absolutePath: `/${id}/report.pdf` } }))
    files.readBytes.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const store = {
      observe: vi.fn(), release: vi.fn(), subscribe: () => () => {},
      entriesOf: () => [], producedOf: () => [{ path: 'report.pdf', seq: 1, time: 1 }],
    } as unknown as SessionResourcesStore
    const render = async (id: string) => { await act(async () => { root.render(h(Panel, { ctx, store, sessionId: SessionId(id) })) }) }
    await render('a')
    await click('下载')
    const signal = files.readBytes.mock.calls[0]![3] as AbortSignal
    await render('b')
    expect(signal.aborted).toBe(true)
    expect(container.textContent).toContain('远端路径：/b/report.pdf')
    expect(container.textContent).not.toContain('/a/report.pdf')
    await act(async () => { finish({ ok: true, value: { absolutePath: '/a/report.pdf', offset: 0, eof: true, data: new Uint8Array([1]) } }) })
    expect(actions.save).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')).toBeNull()
  })

  it('explains unavailable download capabilities', async () => {
    const { files } = fixture()
    const ctx = { get: (key: string) => key === 'remote' ? { workspaceFiles: files } : undefined } as unknown as Context
    await act(async () => { root.render(h(ProducedFileRow, { ctx, sessionId: SessionId('a'), file, time: '' })) })
    await click('下载')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('能力不可用')
  })
})
