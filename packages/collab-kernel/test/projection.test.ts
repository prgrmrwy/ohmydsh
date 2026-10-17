import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Root, RootContent, Paragraph } from 'mdast'
import { project } from '../src/projection/index.js'
import { projectionState } from './fixtures/projection-state.js'

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

describe('projection', () => {
  it('projection-01 中文场景：当前 charter、待 ack、request、升级、决定与投递状态', () => {
    const result = project(projectionState(), { lead: 'reachable', bob: 'paused', gone: 'unreachable' })
    expect(result).toContain('Charter')
    expect(result).toContain('revision 2')
    expect(result).toContain('C2')
    expect(result).toContain('bob')
    expect(result).toContain('R1')
    expect(result).toContain('E1')
    expect(result).toContain('bob')
    expect(result).toContain('awaitingChannel')
    expect(result).toContain('pending')
    expect(result).toContain('unknown')
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
    expect(root.children.filter(node => node.type === 'heading')).toHaveLength(9)
    expect(root.children.some(node => node.type === 'html' || node.type === 'code')).toBe(false)
    expect(root.children.filter(node => node.type === 'link')).toHaveLength(0)
    expect(paragraphs(root).some(node => textOf(node).includes('x` ## 已决定 - [点我](http://evil)<script>'))).toBe(true)
    const bad = (node: { type: string; children?: unknown[] }): boolean =>
      ['heading', 'link', 'html', 'code', 'inlineCode', 'list'].includes(node.type) || !!node.children?.some(child => bad(child as { type: string; children?: unknown[] }))
    for (const node of paragraphs(root)) expect(bad(node)).toBe(false)
    expect(root.children.filter(node => node.type === 'heading')).toHaveLength(9)
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
})
