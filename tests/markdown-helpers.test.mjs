import test from 'node:test'
import assert from 'node:assert/strict'
import {
  blankFencedBlocks,
  stripCode,
  sectionAnchors,
  h2WithoutAnchor,
  extractLinks,
  resolveLinkTarget,
  isTrackedPathOrDir,
  cjkRatio,
  firstH1,
  beforeFirstH2,
  sectionBody,
  fixtureBlock,
  anchorSequenceDiff,
  trackedFiles,
  indexEntry,
} from './helpers/markdown.mjs'

test('blankFencedBlocks keeps line numbers and removes fence content', () => {
  const text = ['a', '```js', 'const x = "[l](gone.md)"', '```', 'b', '~~~', 'tilde', '~~~', 'c'].join('\n')
  const out = blankFencedBlocks(text)
  assert.equal(out.split('\n').length, 9)
  assert.doesNotMatch(out, /gone\.md|tilde|const x/)
  assert.deepEqual(out.split('\n').filter(Boolean), ['a', 'b', 'c'])
})

test('stripCode removes inline code spans as well as fences', () => {
  const out = stripCode('keep `[x](inline.md)` this\n```\n[y](fence.md)\n```\nend')
  assert.doesNotMatch(out, /inline\.md|fence\.md/)
  assert.match(out, /keep\s+this/)
})

test('sectionAnchors extracts keys with 1-based lines, ignoring fenced examples', () => {
  const text = ['<!-- section: what-it-does -->', '## What', '```', '<!-- section: fake -->', '```', '<!-- section:quick-start -->', '## Quick'].join('\n')
  assert.deepEqual(sectionAnchors(text), [
    { key: 'what-it-does', line: 1 },
    { key: 'quick-start', line: 6 },
  ])
})

test('h2WithoutAnchor reports an h2 not directly followed by an anchor', () => {
  const text = ['## A', '<!-- section: a -->', '', 'text', '## B', 'text', '```', '## in fence', '```', '', '## C', '', '<!-- section: c -->'].join('\n')
  assert.deepEqual(h2WithoutAnchor(text), [{ line: 5, heading: '## B' }])
})

test('extractLinks finds inline links, images and reference definitions with lines, skipping code', () => {
  const text = [
    'See [a](docs/a.md#L3) and ![img](pic.png "title") here.',
    '`[no](code.md)`',
    '[ref]: ./b.md',
    '[ext](https://example.com/x)',
    '[angle](<with space.md>)',
    '<img alt="x" src="docs/assets/x.svg" width="100%">',
  ].join('\n')
  const links = extractLinks(text)
  assert.deepEqual(
    links.map((l) => [l.line, l.target]),
    [
      [1, 'docs/a.md#L3'],
      [1, 'pic.png'],
      [3, './b.md'],
      [4, 'https://example.com/x'],
      [5, 'with space.md'],
      [6, 'docs/assets/x.svg'],
    ],
  )
})

test('resolveLinkTarget resolves relative targets, drops anchors, ignores external and anchor-only', () => {
  assert.equal(resolveLinkTarget('docs/architecture/x.md', '../adr/ADR-1.md#top'), 'docs/adr/ADR-1.md')
  assert.equal(resolveLinkTarget('README.md', 'docs/a%20b.md'), 'docs/a b.md')
  assert.equal(resolveLinkTarget('docs/x.md', '/CLAUDE.md'), 'CLAUDE.md')
  assert.equal(resolveLinkTarget('README.md', 'https://example.com'), null)
  assert.equal(resolveLinkTarget('README.md', 'mailto:a@b.c'), null)
  assert.equal(resolveLinkTarget('README.md', '#anchor'), null)
  assert.equal(resolveLinkTarget('a.md', '../../outside.md'), '../../outside.md')
})

test('isTrackedPathOrDir accepts tracked files and their parent directories only', () => {
  const files = ['docs/adr/a.md', 'README.md']
  assert.equal(isTrackedPathOrDir(files, 'docs/adr/a.md'), true)
  assert.equal(isTrackedPathOrDir(files, 'docs/adr'), true)
  assert.equal(isTrackedPathOrDir(files, 'docs/adr/'), true)
  assert.equal(isTrackedPathOrDir(files, 'docs/nope.md'), false)
  assert.equal(isTrackedPathOrDir(files, '../x'), false)
})

test('cjkRatio ignores code, link targets and whitespace', () => {
  const english = 'Hello world.\n```\n中文中文中文中文\n```\n`中文` [link](中文.md)'
  assert.ok(cjkRatio(english) < 0.05)
  const chinese = '这是一个中文说明 with `code` and [链接](x.md)'
  assert.ok(cjkRatio(chinese) > 0.2)
  assert.equal(cjkRatio(''), 0)
})

test('firstH1 returns the first level-one heading outside fences', () => {
  assert.equal(firstH1('```\n# no\n```\n# Real title\n# Second'), 'Real title')
  assert.equal(firstH1('no heading'), null)
})

test('trackedFiles and indexEntry read the git index', () => {
  const files = trackedFiles()
  assert.ok(files.includes('package.json'))
  const entry = indexEntry('package.json')
  assert.equal(entry.mode, '100644')
  assert.match(entry.blob, /^\{/)
  assert.equal(indexEntry('does/not/exist'), null)
})

test('sectionBody returns the lines between an anchor and the next level-2 heading, ignoring fenced headings', () => {
  const text = ['## A', '<!-- section: a -->', 'one', '### sub', '```', '## not a heading', '```', 'two', '', '## B', '<!-- section: b -->', 'three'].join('\n')
  assert.equal(sectionBody(text, 'a'), ['one', '### sub', '```', '## not a heading', '```', 'two', ''].join('\n'))
  assert.equal(sectionBody(text, 'b'), 'three')
  assert.equal(sectionBody(text, 'missing'), null)
})

test('fixtureBlock extracts the fence that directly follows the marker', () => {
  const text = ['x', '<!-- fixture: demo -->', '', '```yaml', 'a: 1', 'b: [2]', '```', 'tail', '<!-- fixture: bare -->', 'not a fence'].join('\n')
  assert.deepEqual(fixtureBlock(text, 'demo'), { line: 2, info: 'yaml', content: 'a: 1\nb: [2]' })
  assert.equal(fixtureBlock(text, 'bare'), null)
  assert.equal(fixtureBlock(text, 'absent'), null)
  assert.equal(fixtureBlock('<!-- fixture: open -->\n```\nnever closed', 'open'), null)
})

test('anchorSequenceDiff reports the first differing index and both values', () => {
  assert.equal(anchorSequenceDiff(['a', 'b'], ['a', 'b']), null)
  assert.deepEqual(anchorSequenceDiff(['a', 'faq', 'b'], ['a', 'b']), { index: 1, left: 'faq', right: 'b' })
  assert.deepEqual(anchorSequenceDiff(['a'], ['a', 'b']), { index: 1, left: null, right: 'b' })
})

test('beforeFirstH2 stops at the first level-two heading outside fences', () => {
  const text = ['# T', '```', '## not a heading', '```', 'intro', '## Real', 'body'].join('\n')
  assert.equal(beforeFirstH2(text), ['# T', '```', '## not a heading', '```', 'intro'].join('\n'))
  assert.equal(beforeFirstH2('# T\nonly'), '# T\nonly')
})
