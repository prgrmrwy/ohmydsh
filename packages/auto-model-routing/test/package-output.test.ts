import { expect, it } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import oracle from './fixtures/routing-oracle-0.4.2.json' with { type: 'json' }

const pkg = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(path, 'utf8')
const files = (root: string, ext: RegExp) => readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(f => ext.test(f)).map(f => [f, read(join(root, f))] as const)

it('spec Scenario "源码与文案不含版本"', () => {
 // 1. Build from an output directory that still holds 0.4.2 artifacts, then list the npm package.
 const work = mkdtempSync(join(tmpdir(), 'amr-pack-'))
 try {
  for (const entry of readdirSync(pkg)) if (!['lib', 'node_modules'].includes(entry)) cpSync(join(pkg, entry), join(work, entry), { recursive: true })
  mkdirSync(join(work, 'lib'), { recursive: true })
  cpSync(join(pkg, 'test/fixtures/lib-0.4.2'), join(work, 'lib'), { recursive: true })
  symlinkSync(resolve(pkg, '../../node_modules'), join(work, 'node_modules'), 'dir')
  execFileSync('npm', ['run', 'build'], { cwd: work, stdio: 'pipe', env: { ...process.env, npm_config_offline: 'true' } })
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: work, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true' } })) as [{ files: { path: string }[] }]
  const paths = packed.files.map(f => f.path)
  for (const gone of ['lib/router.js', 'lib/judgements.js', 'lib/policy-v2.js', 'lib/policy-v2-rubric.json']) expect(paths, gone).not.toContain(gone)
  for (const kept of ['lib/index.js', 'lib/client.js', 'lib/usage-report.js', 'skills/subagent-model-routing/SKILL.md', 'skills/auto-model-routing-report/SKILL.md']) expect(paths, kept).toContain(kept)
 } finally { rmSync(work, { recursive: true, force: true }) }

 // 2. Source text.
 const src = files(join(pkg, 'src'), /\.ts$/)
 const literal = (word: string) => src.flatMap(([f, t]) => [...t.matchAll(new RegExp(`['"\`][^'"\`\\n]*${word}[^'"\`\\n]*['"\`]`, 'g'))].map(m => `${f}: ${m[0]}`))
 expect(literal('policy-v2')).toEqual(["index.ts: 'state/auto-model-routing/policy-v2'"])
 expect(literal('legacy')).toEqual([])
 for (const id of ['rubricVersion', 'pluginVersion']) expect(src.filter(([, t]) => new RegExp(`\\b${id}\\b`).test(t)).map(([f]) => f), id).toEqual([])
 for (const id of ['policyVersion', 'mappingVersion']) expect(src.filter(([, t]) => new RegExp(`\\b${id}\\b`).test(t)).map(([f]) => f).sort(), id).toEqual(['feedback.ts', 'policy-store.ts', 'usage-report.ts'])

 // 3. Agent-facing copy: tool description and parameters, and both skills.
 const tool = read(join(pkg, 'src/subagent-tool.ts'))
 const description = /description: '([^']*)'/.exec(tool)![1]!
 const params = [...tool.matchAll(/description: '([^']*)' \}/g)].map(m => m[1]).join('\n')
 const skills = ['subagent-model-routing', 'auto-model-routing-report'].map(s => read(join(pkg, 'skills', s, 'SKILL.md')))
 for (const text of [description, params, ...skills]) for (const word of ['policy-v2', 'legacy', '原策略', '旧策略', '回滚']) expect(text, word).not.toContain(word)

 // 4. The rule file is byte-identical to the one before the rename.
 expect(createHash('sha256').update(readFileSync(join(pkg, 'src/rubric.json'))).digest('hex')).toBe(oracle.rubricSha256)
 expect(existsSync(join(pkg, 'src/policy-v2-rubric.json'))).toBe(false)
}, 120_000)
