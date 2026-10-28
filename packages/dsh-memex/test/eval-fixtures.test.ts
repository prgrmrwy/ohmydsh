import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, linkSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { materializeFixture, validateFixture, type FixtureManifest } from '../src/eval/fixtures.js'

function fixture() {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'memex-eval-fixture-'))
  const source = join(base, 'source')
  const files = { 'repo/config.json': '{"timeout":30}\n', 'library/cards/timeout.md': '---\ntitle: Timeout\nsource: dsh\n---\nTimeout is 30.\n' }
  const manifest: FixtureManifest = Object.entries(files).map(([path, text]) => {
    mkdirSync(dirname(join(source, path)), { recursive: true })
    writeFileSync(join(source, path), text)
    return { path, size: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }
  })
  return { base, source, manifest, files }
}

describe('fixed eval resources', () => {
  it('EVAL-005: 固定资源成功物化', () => {
    const f = fixture()
    const target = join(f.base, 'attempt')
    const verified = validateFixture(f.source, f.manifest)
    materializeFixture(verified, target)
    for (const [path, text] of Object.entries(f.files)) {
      expect(readFileSync(join(target, path), 'utf8')).toBe(text)
      expect(readFileSync(join(f.source, path), 'utf8')).toBe(text)
      expect(lstatSync(join(target, path)).nlink).toBe(1)
    }
    for (const part of ['repo', 'library']) {
      const cwd = join(target, part)
      expect(execFileSync('git', ['remote'], { cwd, encoding: 'utf8' })).toBe('')
      expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd, encoding: 'utf8' }).trim()).toBe('Memex selftest fixture')
    }
  })

  it('EVAL-006: 根合法但叶子链接被拒绝', () => {
    const f = fixture()
    const outside = join(f.base, 'outside.md')
    writeFileSync(outside, 'not part of the fixture')
    symlinkSync(outside, join(f.source, 'library/cards/linked.md'))
    expect(() => validateFixture(f.source, f.manifest)).toThrow(/symbolic link/)
  })

  it('EVAL-007: 替换为真实副本被拒绝', () => {
    const f = fixture()
    writeFileSync(join(f.source, 'repo/config.json'), '{"timeout":99}\n')
    expect(() => validateFixture(f.source, f.manifest)).toThrow(/hash mismatch/)
  })

  it('EVAL-008: 已有目标不被清理', () => {
    const f = fixture()
    const target = join(f.base, 'occupied')
    mkdirSync(target)
    writeFileSync(join(target, 'keep'), 'keep')
    expect(() => materializeFixture(validateFixture(f.source, f.manifest), target)).toThrow(/already exists/)
    expect(readFileSync(join(target, 'keep'), 'utf8')).toBe('keep')
  })

  it('rejects hard links before reading resource content', () => {
    const f = fixture()
    linkSync(join(f.source, 'repo/config.json'), join(f.base, 'alias'))
    expect(() => validateFixture(f.source, f.manifest)).toThrow(/hard link/)
  })

  it('rejects extra ordinary files and unsafe manifest paths', () => {
    const f = fixture()
    writeFileSync(join(f.source, 'extra'), 'extra')
    expect(() => validateFixture(f.source, f.manifest)).toThrow(/unexpected entry/)
    expect(() => validateFixture(f.source, [{ ...f.manifest[0]!, path: '../escape' }])).toThrow(/unsafe resource path/)
  })

  it('rejects gitdir metadata before materialization', () => {
    const f = fixture()
    writeFileSync(join(f.source, 'repo/.git'), 'gitdir: /outside')
    expect(() => validateFixture(f.source, f.manifest)).toThrow(/forbidden metadata/)
  })

  it('rejects symbolic links in the source parent chain', () => {
    const f = fixture()
    symlinkSync(f.source, join(f.base, 'alias'))
    expect(() => validateFixture(join(f.base, 'alias'), f.manifest)).toThrow(/symbolic link/)
  })
})
