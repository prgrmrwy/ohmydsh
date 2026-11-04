import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertDeclaredHash, materializeSnapshot, prepareSnapshot, verifySnapshot } from '../src/eval/retrieval/snapshot.js'

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'retrieval-snapshot-'))
  const sourceRoot = join(root, 'library')
  mkdirSync(join(sourceRoot, 'cards'), { recursive: true })
  const card = (slug: string, category: string) => `---\ntitle: ${slug}\ncategory: ${category}\n---\ncontent\n`
  writeFileSync(join(sourceRoot, 'cards', 'handoff-card.md'), card('handoff-card', 'handoff'))
  writeFileSync(join(sourceRoot, 'cards', 'probe-x.md'), card('probe-x', 'research'))
  writeFileSync(join(sourceRoot, 'cards', 'decision-card.md'), card('decision-card', 'decision'))
  writeFileSync(join(sourceRoot, '.memexrc'), JSON.stringify({ openaiApiKey: 'ignore', nestedSlugs: true, other: 1 }))
  return { root, sourceRoot }
}

describe('快照不可变输入清单与元卡排除', () => {
  it('默认规则排除元卡并列出', () => {
    const f = fixture()
    const prepared = prepareSnapshot({ sourceRoot: f.sourceRoot })
    expect(prepared.excludedSlugs.sort()).toEqual(['handoff-card', 'probe-x'])
    expect(prepared.slugs).toEqual(['decision-card'])
    expect(prepared.manifest.map(item => item.path)).toEqual(['.memexrc', 'cards/decision-card.md'])
    const expectedHash = createHash('sha256').update(prepared.manifest.map(item => `${item.path}\0${item.sha256}\n`).join('')).digest('hex')
    expect(prepared.manifestHash).toBe(expectedHash)
    const target = join(f.root, 'snapshot')
    materializeSnapshot(target, prepared)
    expect(readFileSync(join(target, 'cards', 'decision-card.md'), 'utf8')).toContain('content')
    expect(lstatSync(join(target, 'cards')).mode & 0o777).toBe(0o700)
    expect(lstatSync(join(target, 'cards', 'decision-card.md')).mode & 0o777).toBe(0o600)
  })

  it('非白名单配置不进入快照', () => {
    const f = fixture()
    const prepared = prepareSnapshot({ sourceRoot: f.sourceRoot })
    expect(prepared.files.get('.memexrc')?.toString()).toBe('{"nestedSlugs":true}\n')
    expect(Object.keys(JSON.parse(prepared.files.get('.memexrc')!.toString()))).toEqual(['nestedSlugs'])
  })

  it('声明哈希不符拒绝运行', () => {
    expect(() => assertDeclaredHash('0'.repeat(64), '1'.repeat(64))).toThrow(/declared.*actual|expected.*actual/i)
  })

  it('清单保留 cards 非 Markdown 文件但不把它当成卡片', () => {
    const f = fixture()
    writeFileSync(join(f.sourceRoot, 'cards', 'README'), 'notes')
    writeFileSync(join(f.sourceRoot, 'cards', '.DS_Store'), 'metadata')
    const prepared = prepareSnapshot({ sourceRoot: f.sourceRoot })
    expect(prepared.manifest.map(item => item.path)).toContain('cards/README')
    expect(prepared.manifest.map(item => item.path)).toContain('cards/.DS_Store')
    expect(prepared.slugs).toEqual(['decision-card'])
  })

  it('支持内核兼容且路径安全的干扰卡 slug', () => {
    const f = fixture()
    const distractorSlugs = ['api_retry', 'API-timeout', 'lease.v2', 'card0', '中文卡']
    const prepared = prepareSnapshot({ sourceRoot: f.sourceRoot, distractors: distractorSlugs.map(slug => ({ slug, content: 'noise' })) })
    expect(prepared.slugs).toEqual(expect.arrayContaining(distractorSlugs))
    for (const slug of ['bad..name', '../escape', '/absolute', 'a//b', 'a\\b', 'a:b', 'bad\0slug']) {
      expect(() => prepareSnapshot({ sourceRoot: f.sourceRoot, distractors: [{ slug, content: 'noise' }] })).toThrow(/invalid distractor slug/)
    }
  })

  it('排除的原卡仍参与干扰卡冲突检查', () => {
    const f = fixture()
    expect(() => prepareSnapshot({ sourceRoot: f.sourceRoot, distractors: [{ slug: 'handoff-card', content: 'noise' }] })).toThrow(/conflict.*handoff-card/i)
  })

  it('解析常见 YAML category key、标量引号与 Unicode escape', () => {
    const forms = [
      'category: eval',
      '"category": eval',
      "'category': 'eval'",
      'category: "eval"',
      "category: 'eval'",
      'category: "ev\\u0061l"',
      '"catego\\u0072y": "eval"',
      '  title: Fixture\n  category: eval',
    ]
    for (const line of forms) {
      const f = fixture()
      writeFileSync(join(f.sourceRoot, 'cards', 'decision-card.md'), `---\n${line}\n---\ncontent\n`)
      const prepared = prepareSnapshot({ sourceRoot: f.sourceRoot })
      expect(prepared.excludedSlugs).toContain('decision-card')
      expect(prepared.slugs).not.toContain('decision-card')
    }
  })

  it('无法安全解释 category 标量或 YAML merge 时拒绝快照', () => {
    for (const metadata of ['category: [eval]', 'category: {name: eval}', 'category: &kind eval', 'category: *kind', 'category: >\n  eval', 'category:', '<<: *defaults', '{category: eval}']) {
      const f = fixture()
      writeFileSync(join(f.sourceRoot, 'cards', 'decision-card.md'), `---\n${metadata}\n---\ncontent\n`)
      expect(() => prepareSnapshot({ sourceRoot: f.sourceRoot })).toThrow(/category|merge/i)
    }
  })

  it('按根映射缩进识别 category 并拒绝注释后的 flow frontmatter', () => {
    const nested = fixture()
    writeFileSync(join(nested.sourceRoot, 'cards', 'decision-card.md'), '---\nmetadata:\n  category: eval\n---\ncontent\n')
    expect(prepareSnapshot({ sourceRoot: nested.sourceRoot }).slugs).toContain('decision-card')

    const block = fixture()
    writeFileSync(join(block.sourceRoot, 'cards', 'decision-card.md'), '---\ncategory: decision\nnotes: |\n  category: eval\n---\ncontent\n')
    expect(prepareSnapshot({ sourceRoot: block.sourceRoot }).slugs).toContain('decision-card')

    const flow = fixture()
    writeFileSync(join(flow.sourceRoot, 'cards', 'decision-card.md'), '---\n# comment\n{category: eval}\n---\ncontent\n')
    expect(() => prepareSnapshot({ sourceRoot: flow.sourceRoot })).toThrow(/flow frontmatter/i)
  })

  it('按 nestedSlugs 配置映射内核 slug', () => {
    const f = fixture()
    mkdirSync(join(f.sourceRoot, 'cards', 'nested'), { recursive: true })
    writeFileSync(join(f.sourceRoot, 'cards', 'nested', 'leaf.md'), '---\ntitle: Leaf\ncategory: research\n---\nleaf\n')
    writeFileSync(join(f.sourceRoot, '.memexrc'), JSON.stringify({ nestedSlugs: false }))
    expect(prepareSnapshot({ sourceRoot: f.sourceRoot }).slugs).toContain('leaf')
    writeFileSync(join(f.sourceRoot, '.memexrc'), JSON.stringify({ nestedSlugs: true }))
    expect(prepareSnapshot({ sourceRoot: f.sourceRoot }).slugs).toContain('nested/leaf')
  })

  it('运行中改卡或多出文件则整轮无效', () => {
    const f = fixture()
    const prepared = prepareSnapshot({ sourceRoot: f.sourceRoot })
    const target = join(f.root, 'snapshot')
    materializeSnapshot(target, prepared)
    expect(verifySnapshot(target, prepared.manifest)).toEqual({ valid: true, differences: [] })
    writeFileSync(join(target, 'cards', 'decision-card.md'), 'changed')
    expect(verifySnapshot(target, prepared.manifest).valid).toBe(false)
    writeFileSync(join(target, 'cards', 'decision-card.md'), readFileSync(join(f.sourceRoot, 'cards', 'decision-card.md')))
    writeFileSync(join(target, 'cards', 'extra.md'), 'extra')
    expect(verifySnapshot(target, prepared.manifest).differences).toContain('cards/extra.md')
  })
})
