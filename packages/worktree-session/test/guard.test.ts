import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { confinePath } from '../src/host/containment.js'
import { checkTool, physicalDecision, TOOL_CONTRACTS } from '../src/host/guard.js'
import type { OperationRecord } from '../src/wire.js'

const roots: string[] = []
async function fixture(): Promise<{ root: string; worktree: string; record: OperationRecord }> {
  const root = await mkdtemp(join(tmpdir(), 'ws-guard-'))
  roots.push(root)
  const worktree = join(root, '.worktrees', 'task')
  await mkdir(join(worktree, 'src'), { recursive: true })
  await writeFile(join(worktree, 'src', 'a.ts'), 'x\n')
  const record: OperationRecord = {
    schemaVersion: 2, operationId: 'operation-12345678', repoRoot: root, gitCommonDir: join(root, '.git'),
    baseRef: 'main', baseCommit: 'abc', taskBranch: 'ws/task', worktreePath: worktree, taskHash: 'h',
    dependencyMode: 'lean', dshHome: join(root, '.git', 'ws', 'home'), phase: 'prepared',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    binding: { mode: 'source-session', sourceSessionId: 'session-a', state: 'admitted', updatedAt: '2026-01-01T00:00:00.000Z' },
  }
  return { root, worktree, record }
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('fail-closed managed-root tool policy', () => {
  it('pins the installed rc.7 local and delegation tool contracts', () => {
    expect(TOOL_CONTRACTS).toEqual(expect.objectContaining({
      bash: expect.objectContaining({ pathFields: ['workdir'] }),
      read: expect.objectContaining({ pathFields: ['file_path'] }),
      read_image: expect.objectContaining({ pathFields: ['file_path'] }),
      write: expect.objectContaining({ pathFields: ['file_path'] }),
      edit: expect.objectContaining({ pathFields: ['file_path'] }),
      glob: expect.objectContaining({ pathFields: ['path'] }),
      grep: expect.objectContaining({ pathFields: ['path'] }),
      subagent: expect.objectContaining({ kind: 'delegation' }),
      send_message: expect.objectContaining({ kind: 'delegation' }),
      ws: expect.objectContaining({ kind: 'maintenance', pathFields: ['path'] }),
    }))
    expect(TOOL_CONTRACTS).not.toHaveProperty('subagent_fork')
  })

  it('rejects bash without an explicit workdir and reports the exact managed root', async () => {
    const { worktree, record } = await fixture()
    const synchronous = checkTool({ name: 'bash', args: { command: 'git status' } }, record)
    expect(synchronous).toMatch(/workdir/)
    expect(synchronous).toContain(worktree)
    const physical = await physicalDecision({ name: 'bash', arguments: { command: 'git status', workdir: '' } }, record)
    expect(physical).toMatchObject({ kind: 'deny' })
    if (physical.kind === 'deny') expect(physical.reason).toContain(worktree)
    expect(checkTool({ name: 'bash', args: { workdir: worktree, command: 'ls' } }, record)).toBeUndefined()
  })

  it('rejects bash workdir outside the managed root (main checkout)', async () => {
    const { root, record } = await fixture()
    const reason = checkTool({ name: 'bash', args: { workdir: root, command: 'ls' } }, record)
    expect(reason).toMatch(/超出托管执行目录/)
    expect(reason).toMatch(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })

  it('rejects relative file paths that would resolve against the source cwd', async () => {
    const { record } = await fixture()
    expect(checkTool({ name: 'edit', args: { file_path: 'src/a.ts' } }, record)).toMatch(/绝对路径/)
    expect(checkTool({ name: 'read', args: { file_path: 'src/a.ts' } }, record)).toMatch(/绝对路径/)
  })

  it('rejects file targets outside the managed root', async () => {
    const { root, worktree, record } = await fixture()
    expect(checkTool({ name: 'write', args: { file_path: join(root, 'refuse.txt') } }, record)).toMatch(/超出托管执行目录/)
    expect(checkTool({ name: 'read_image', args: { file_path: join(root, 'outside.png') } }, record)).toMatch(/超出托管执行目录/)
    expect(checkTool({ name: 'read_image', args: { file_path: join(worktree, 'inside.png') } }, record)).toBeUndefined()
    expect(checkTool({ name: 'edit', args: { file_path: join(worktree, 'src', 'a.ts') } }, record)).toBeUndefined()
  })

  it('rejects search roots outside the managed root and missing roots', async () => {
    const { root, worktree, record } = await fixture()
    expect(checkTool({ name: 'glob', args: { pattern: '**/*.ts' } }, record)).toMatch(/搜索根/)
    expect(checkTool({ name: 'grep', args: { pattern: 'x', path: 'src' } }, record)).toMatch(/绝对路径/)
    expect(checkTool({ name: 'grep', args: { pattern: 'x', path: root } }, record)).toMatch(/超出托管执行目录/)
    expect(checkTool({ name: 'glob', args: { pattern: '**/*.ts', path: worktree } }, record)).toBeUndefined()
  })

  it('denies a cleaned historical Session entirely', async () => {
    const { worktree, record } = await fixture()
    const cleaned = { ...record, binding: { mode: 'source-session' as const, sourceSessionId: 'session-a', state: 'cleaned' as const, updatedAt: '2026-01-02T00:00:00.000Z' } }
    expect(checkTool({ name: 'bash', args: { workdir: worktree, command: 'ls' } }, cleaned)).toMatch(/已清理/)
  })

  it('allows audited continuable delegation and denies unsupported one-shot providers', async () => {
    const { record } = await fixture()
    expect(checkTool({ name: 'subagent', args: { description: 'x', prompt: 'y', run_in_background: true } }, record)).toMatch(/Host 配置已审计/)
    expect(checkTool({ name: 'subagent', args: { description: 'x', prompt: 'y', run_in_background: true } }, record, undefined, ['subagent'])).toBeUndefined()
    expect(checkTool({ name: 'subagent', args: { description: 'x', prompt: 'y', run_in_background: false } }, record, undefined, ['subagent'])).toMatch(/continuable background/)
    expect(checkTool({ name: 'send_message', args: { subagent_id: 'child', message: 'next' } }, record)).toBeUndefined()
    expect(checkTool({ name: 'ws', args: { action: 'status', path: record.worktreePath } }, record)).toBeUndefined()
    expect(checkTool({ name: 'subagent_fork', args: { prompt: 'fork' } }, record)).toMatch(/无法证明/)
    expect(checkTool({ name: 'subagent_codex', args: { prompt: 'codex' } }, record)).toMatch(/无法证明/)
  })

  it('leaves non-local tools untouched and fails closed on schema-drifted local capability', async () => {
    const { record } = await fixture()
    expect(checkTool({ name: 'web_search', args: { query: 'x' } }, record)).toBeUndefined()
    expect(checkTool({ name: 'future_local_tool', args: { file_path: '/tmp/x' } }, record)).toMatch(/未经审计/)
    const bare = { ...record, binding: undefined }
    expect(checkTool({ name: 'bash', args: {} }, bare)).toBeUndefined()
  })

  it('confinement resolves symlink ancestors that escape the managed root', async () => {
    const { root, worktree, record } = await fixture()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 's3cret\n')
    const link = join(worktree, 'escape')
    await symlink(outside, link)
    const trapped = await confinePath(worktree, join(link, 'secret.txt'))
    expect(trapped.allowed).toBe(false)
    expect(await physicalDecision({ name: 'read', arguments: { file_path: join(link, 'secret.txt') } }, record)).toMatchObject({ kind: 'deny' })
    expect(await physicalDecision({ name: 'read_image', arguments: { file_path: join(link, 'secret.png') } }, record)).toMatchObject({ kind: 'deny' })
    expect(await physicalDecision({ name: 'write', arguments: { file_path: join(link, 'new.txt') } }, record)).toMatchObject({ kind: 'deny' })
  })

  it('confinement allows existing paths physically inside the managed root', async () => {
    const { worktree } = await fixture()
    const ok = await confinePath(worktree, join(worktree, 'src', 'a.ts'))
    expect(ok.allowed).toBe(true)
    const missing = await confinePath(worktree, join(worktree, 'src', 'not-there.ts'))
    expect(missing.allowed).toBe(true)
  })
})
