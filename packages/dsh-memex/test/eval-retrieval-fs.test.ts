import { execFileSync } from 'node:child_process'
import { fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertUniqueSlugs, createRunDirectory, readLibraryFiles } from '../src/eval/retrieval/fs-boundary.js'
import { main } from '../src/cli/eval-retrieval.js'

function fixture() {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'retrieval-fs-'))
  const home = join(base, 'home')
  const libraryRoot = join(base, 'library')
  mkdirSync(join(home, '.dsh-memex-eval', 'retrieval'), { recursive: true })
  mkdirSync(join(libraryRoot, 'cards'), { recursive: true })
  writeFileSync(join(libraryRoot, 'cards', 'a.md'), '---\ntitle: A\n---\nA card\n')
  return { base, home, libraryRoot }
}

describe('检索评测的文件系统边界', () => {
  it('普通库制作快照且原库不变', async () => {
    const f = fixture()
    for (const slug of ['b', 'c', 'd', 'e']) writeFileSync(join(f.libraryRoot, 'cards', `${slug}.md`), `---\ntitle: ${slug}\n---\nA card\n`)
    const fingerprint = () => [...readLibraryFiles(f.libraryRoot)].map(([path, bytes]) => [path, bytes.toString(), lstatSync(join(f.libraryRoot, path)).mtimeMs])
    const before = fingerprint()
    const gold = join(f.base, 'gold.json')
    writeFileSync(gold, JSON.stringify([{ id: 'q', query: 'card', targets: ['a'], type: 'single-hop', topic: 'fixture', origin: 'fixture', set: 'dev' }]))
    const decoy = join(f.base, 'noise.md'); writeFileSync(decoy, '---\ntitle: Noise\n---\nA decoy\n')
    const code = await main(['--library', f.libraryRoot, '--goldset', gold, '--set', 'dev', '--distractor', `noise=${decoy}`], {
      home: f.home, runId: 'run-1', stdout() {}, stderr() {},
      runner: async () => ({ ok: true, exitCode: 0, stdout: '## a\nA\nA card\n', stderr: '' }),
    })
    expect(code).toBe(0)
    const run = join(f.home, '.dsh-memex-eval', 'retrieval', 'run-1')
    const cards = join(run, 'snapshot', 'cards')
    expect(readdirSync(cards).sort()).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'noise.md'])
    expect(lstatSync(run).mode & 0o777).toBe(0o700)
    expect(lstatSync(cards).mode & 0o777).toBe(0o700)
    for (const name of readdirSync(cards)) expect(lstatSync(join(cards, name)).mode & 0o777).toBe(0o600)
    expect(fingerprint()).toEqual(before)
    expect(readdirSync(f.libraryRoot)).toEqual(['cards'])
    expect(relative(f.libraryRoot, run).startsWith('..')).toBe(true)
  })

  it('软链接卡片在打开前被拒绝', () => {
    const f = fixture()
    const outside = join(f.base, 'outside.md')
    const link = join(f.libraryRoot, 'cards', 'x.md')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, link)
    const opened: string[] = []
    expect(() => readLibraryFiles(f.libraryRoot, { open(path, flags) { opened.push(path); return openSync(path, flags) } })).toThrow(/cards\/x\.md.*symlink|symlink.*cards\/x\.md/i)
    expect(opened).not.toContain(link)
    expect(opened).not.toContain(outside)
  })

  it('打开后用 fstat 拒绝身份变化', () => {
    const f = fixture()
    const opened: string[] = []
    expect(() => readLibraryFiles(f.libraryRoot, {
      open(path, flags) { opened.push(path); return openSync(path, flags) },
      fstat(fd) { const stat = fstatSync(fd); return { ...stat, isFile: () => false } as never },
    })).toThrow(/not a regular file or hard link/)
    expect(opened).toContain(join(f.libraryRoot, 'cards', 'a.md'))
  })

  it('硬链接被拒绝', () => {
    const f = fixture()
    linkSync(join(f.libraryRoot, 'cards', 'a.md'), join(f.base, 'alias.md'))
    expect(() => readLibraryFiles(f.libraryRoot)).toThrow(/hard link.*cards\/a\.md/i)
  })

  it('命名管道被拒绝', () => {
    if (process.platform === 'win32') return // Windows does not provide portable POSIX mkfifo semantics.
    const f = fixture()
    const fifo = join(f.libraryRoot, 'cards', 'p.md')
    execFileSync('mkfifo', [fifo])
    expect(() => readLibraryFiles(f.libraryRoot)).toThrow(/not a regular file.*cards\/p\.md/i)
  })

  it('评测根经别名落入某个库时被拒绝', () => {
    if (process.platform === 'win32') return // Windows symlink creation requires platform-specific privilege.
    const f = fixture()
    const target = join(f.base, 'linked-library')
    mkdirSync(join(target, 'cards'), { recursive: true })
    const evalRoot = join(f.home, '.dsh-memex-eval')
    rmSync(evalRoot, { recursive: true })
    symlinkSync(target, evalRoot)
    let failure: unknown
    try { createRunDirectory({ home: f.home, libraryRoot: f.libraryRoot, runId: 'r' }) } catch (error) { failure = error }
    expect(String(failure)).toMatch(/memory library|cards|symlink/i)
    expect(String(failure)).toContain(realpathSync(target))
    expect(readdirSync(target)).toEqual(['cards'])
  })

  it('评测根是指向未初始化库的软链接时被拒绝', () => {
    if (process.platform === 'win32') return // Windows symlink creation requires platform-specific privilege.
    const f = fixture()
    const target = join(f.base, 'empty-library')
    mkdirSync(target)
    const evalRoot = join(f.home, '.dsh-memex-eval')
    rmSync(evalRoot, { recursive: true })
    symlinkSync(target, evalRoot)
    expect(() => createRunDirectory({ home: f.home, libraryRoot: f.libraryRoot, runId: 'r' })).toThrow(/symlink/i)
    expect(readdirSync(target)).toEqual([])
  })

  it('祖先中只有名字相近的目录时通过', () => {
    const f = fixture()
    mkdirSync(join(f.home, 'cards-old'))
    expect(() => createRunDirectory({ home: f.home, libraryRoot: f.libraryRoot, runId: 'r' })).not.toThrow()
  })

  it('已存在的运行目录不被覆盖', () => {
    const f = fixture()
    const occupied = join(f.home, '.dsh-memex-eval', 'retrieval', 'taken')
    mkdirSync(occupied)
    writeFileSync(join(occupied, 'keep'), 'keep')
    expect(() => createRunDirectory({ home: f.home, libraryRoot: f.libraryRoot, runId: 'taken' })).toThrow(/already exists|EEXIST/i)
    expect(readFileSync(join(occupied, 'keep'), 'utf8')).toBe('keep')
  })

  it('干扰卡与已有 slug 同名被拒绝', () => {
    expect(() => assertUniqueSlugs(['known-card'], ['new-card'])).not.toThrow()
    expect(() => assertUniqueSlugs(['known-card'], ['known-card'])).toThrow(/conflict.*known-card/)
    expect(() => assertUniqueSlugs(['excluded-card'], ['excluded-card'])).toThrow(/conflict.*excluded-card/)
    expect(() => createRunDirectory({ ...fixture(), runId: '../escape' })).toThrow(/run id/i)
  })
})
