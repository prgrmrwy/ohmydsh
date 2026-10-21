import { expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { project } from '../src/projection/index.js'
import { projectionState } from './fixtures/projection-state.js'

type Node = { type: string; value?: string; children?: Node[] }
function visible(node: Node): string {
  return node.type === 'text' ? node.value ?? '' : node.children?.map(visible).join('') ?? ''
}
function descendants(node: Node): Node[] {
  return [node, ...node.children?.flatMap(descendants) ?? []]
}

it('all CommonMark ASCII punctuation is visible exactly once without added structure', () => {
  const state = projectionState()
  const text = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
  state.items.ack!.title = text
  const ast = fromMarkdown(project(state, {}))
  const paragraph = descendants(ast).find(n => n.type === 'paragraph' && visible(n).startsWith('条目 C2 '))!
  expect(visible(paragraph)).toBe(`条目 C2 ${text}；缺少 bob`)
  expect(descendants(paragraph).every(n => n.type === 'paragraph' || n.type === 'text')).toBe(true)
})

it('rendering is pure and does not reinterpret entity-looking member text', () => {
  const state = projectionState()
  state.members.bob!.statusText = '  &#35; &amp; <status>\\  '
  const before = structuredClone(state)
  const output = project(state, {})
  expect(state).toEqual(before)
  const ast = fromMarkdown(output)
  const node = descendants(ast).find(n => n.type === 'paragraph' && visible(n).includes('状态 &#35; &amp; <status>\\'))
  expect(node).toBeDefined()
  expect(descendants(node!).every(n => n.type === 'paragraph' || n.type === 'text')).toBe(true)
})
