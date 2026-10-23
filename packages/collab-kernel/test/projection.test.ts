import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Root, RootContent, Paragraph } from 'mdast'
import { project } from '../src/projection/index.js'
import { legacyProjectionState, projectionState } from './fixtures/projection-state.js'

function paragraphs(root: Root): Paragraph[] {
  const found: Paragraph[] = []
  const visit = (node: { type: string; children?: RootContent[] }) => {
    if (node.type === 'paragraph') found.push(node as Paragraph)
    node.children?.forEach(visit)
  }
  root.children.forEach(visit)
  return found
}
function textOf(node: RootContent): string {
  const collect = (value: { type: string; value?: string; children?: { type: string; value?: string; children?: unknown[] }[] }): string =>
    value.type === 'text' ? value.value ?? '' : value.children?.map(child => collect(child as { type: string; value?: string; children?: { type: string; value?: string; children?: unknown[] }[] })).join('') ?? ''
  return node.type === 'paragraph' ? node.children.map(child => collect(child)).join('') : ''
}

const HEADINGS = 6
describe('projection', () => {
  it('projection-01 中文场景：当前 charter、待 ack、request、升级、决定与投递状态', () => {
    const state = { ...projectionState(), purpose: '接口协商' }
    const result = project(state, { lead: 'reachable', bob: 'unreachable' })
    expect(result).toContain('Charter：Rules（revision 2）')
    expect(result).toContain('用途：接口协商')
    const pendingAck = result.slice(result.indexOf('## 待确认'), result.indexOf('## 未结 request'))
    expect(pendingAck).toContain('C2'); expect(pendingAck).toContain('bob')
    const open = result.slice(result.indexOf('## 未结 request'))
    expect(open).toContain('R1')
    expect(result).toMatch(/成员 bob：active；在线 unreachable/)
    expect(result).toContain('dv\\-pending')
    expect(result).toContain('unknown')
    expect(result).not.toContain('## 历史条目')
    expect(result).not.toContain('SECRET-')
  })

  it('projection-02 中文场景：投影不包含消息或条目正文', () => {
    const result = project(projectionState(), {})
    expect(result).not.toContain('SECRET-MESSAGE-BODY')
    expect(result).not.toContain('SECRET-ITEM-BODY')
    expect(result).not.toContain('SECRET-CHARTER-BODY')
  })

  it('projection-03 中文场景：恶意标题不会产生用户控制的 Markdown 结构', () => {
    const state = projectionState()
    state.items.ack!.title = 'x`\n## 已决定\n- [点我](http://evil)<script> `'
    const root = fromMarkdown(project(state, {}))
    expect(root.children.filter(node => node.type === 'heading')).toHaveLength(HEADINGS)
    expect(root.children.some(node => node.type === 'html' || node.type === 'code')).toBe(false)
    expect(root.children.filter(node => node.type === 'link')).toHaveLength(0)
    expect(paragraphs(root).some(node => textOf(node).includes('x` ## 已决定 - [点我](http://evil)<script>'))).toBe(true)
    const bad = (node: { type: string; children?: unknown[] }): boolean =>
      ['heading', 'link', 'html', 'code', 'inlineCode', 'list'].includes(node.type) || !!node.children?.some(child => bad(child as { type: string; children?: unknown[] }))
    for (const node of paragraphs(root)) expect(bad(node)).toBe(false)
    expect(root.children.filter(node => node.type === 'heading')).toHaveLength(HEADINGS)
  })

  it('projection-04 中文场景：控制字符清理和标点转义后可见文本不变且为段落', () => {
    const state = projectionState()
    state.items.ack!.title = '  \u0000  <tag>&"x\r\n\u0085  '
    const root = fromMarkdown(project(state, {}))
    const titleNode = paragraphs(root).find(node => textOf(node).includes('条目 C2'))
    expect(titleNode).toBeDefined()
    expect(titleNode?.type).toBe('paragraph')
    expect(textOf(titleNode!)).toBe('条目 C2 <tag>&"x；缺少 bob')
    expect(root.children.some(node => node.type === 'code' || node.type === 'html')).toBe(false)
    expect(root.children.some(node => node.type === 'heading')).toBe(true)
  })

  it('projection-05：恶意用途不能产生额外结构', () => {
    const purpose = '[点我](http://evil) <script> ## 已决定'
    const root = fromMarkdown(project({ ...projectionState(), purpose }, {}))
    const node = paragraphs(root).find(p => textOf(p).includes('<script>'))!
    expect(node).toBeDefined()
    expect(textOf(node)).toBe(`用途：${purpose}`)
    const bad = (n: { type: string; children?: unknown[] }): boolean => ['heading', 'link', 'html'].includes(n.type) || !!n.children?.some(c => bad(c as { type: string; children?: unknown[] }))
    expect(bad(node)).toBe(false)
    expect(root.children.filter(n => n.type === 'heading')).toHaveLength(HEADINGS)
  })

  it('projection-06：锁定的 request 只作为历史出现', () => {
    const state = legacyProjectionState()
    state.items.R8 = { id: 'R8', kind: 'request', title: 'Fresh request', body: '', author: 'lead', revision: 1, status: 'draft', requiredAcks: [], acks: {}, assignee: 'bob', progress: 'open' }
    const result = project(state, {})
    const open = result.slice(result.indexOf('## 未结 request'), result.indexOf('## 历史条目'))
    const history = result.slice(result.indexOf('## 历史条目'))
    expect(result.indexOf('## 历史条目')).toBeGreaterThan(result.indexOf('## 未结 request'))
    expect(open).toContain('R8'); expect(open).not.toContain('R4')
    expect(history).toContain('R4'); expect(history).toContain('E1')
  })

  it('projection-07：投影不含已移除机制', () => {
    const result = project({ ...projectionState(), purpose: 'p' }, { lead: 'reachable' })
    for (const removed of ['paused', 'awaitingChannel', '已决定', '已升级', '等待确认通道']) expect(result).not.toContain(removed)
  })
})
