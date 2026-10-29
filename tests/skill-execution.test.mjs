import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
const ROOT = path.resolve(import.meta.dirname, '..')
async function fixture(t, skill) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'skill 中文 space ')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'deployed-skill')
  await fs.cp(path.join(ROOT, 'skills', skill), dir, { recursive: true })
  const home = path.join(root, 'home'), cwd = path.join(root, 'caller & space'), tools = path.join(root, 'tools')
  await Promise.all([home, cwd, tools].map(p => fs.mkdir(p, { recursive: true })))
  const env = { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: path.join(home, '.dsh'), PATH: tools }
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path' && key !== 'PATH') delete env[key]
  const log = path.join(root, 'calls.jsonl')
  async function pkg(parent, name, bin, relative) {
    const base = path.join(parent, name)
    await fs.mkdir(path.dirname(path.join(base, relative)), { recursive: true })
    await fs.writeFile(path.join(base, 'package.json'), JSON.stringify({ name, bin: { [bin]: relative } }))
    await fs.writeFile(path.join(base, relative), `#!/usr/bin/env node\nimport fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,cwd:process.cwd()})+'\\n');process.exitCode=args.some(a=>a.endsWith('a-fail'))?7:Number(process.env.SKILL_EXIT||0)\n`)
    // Keep fixtures independent of repo module type and executable shims.
    const p = JSON.parse(await fs.readFile(path.join(base, 'package.json')));p.type='module'
    await fs.writeFile(path.join(base, 'package.json'), JSON.stringify(p))
    return path.join(base, relative)
  }
  const entry = path.join(dir, 'scripts', skill === 'ws' ? 'ws.mjs' : 'report.mjs')
  return { root, home, cwd, env, tools, pkg, log,
    run: (args = []) => spawnSync(process.execPath, [entry, ...args], { cwd, env, encoding: 'utf8', timeout: 15000 }),
    calls: async () => (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse),
    library: async name => fs.mkdir(path.join(home, '.dsh-memex', name, 'cards'), { recursive: true }),
  }
}

test('memex standalone helper preserves argv cwd and exit via deployed profile without Bash', async t => {
  const f = await fixture(t, 'memex-recall-report')
  await f.pkg(path.join(f.env.DSH_HOME, 'profiles', 'web', 'node_modules'), 'dsh-memex', 'dsh-memex-recall-report', 'lib/cli/recall-report.js')
  f.env.SKILL_EXIT = '9'
  const args = ['--lib', 'path 中文 & x', '', '"quotes"', '$(touch sentinel)', '--days', '14']
  const r = f.run(args)
  assert.equal(r.status, 9, r.stderr)
  assert.deepEqual(await f.calls(), [{ args, cwd: f.cwd }])
})

test('memex default libraries exclude eval and continue after failure', async t => {
  const f = await fixture(t, 'memex-recall-report')
  await f.pkg(path.join(f.env.DSH_HOME, 'profiles', 'web', 'node_modules'), 'dsh-memex', 'dsh-memex-recall-report', 'lib/cli/recall-report.js')
  for (const name of ['a-fail', 'b-ok', 'eval-test', '.hidden']) await f.library(name)
  await fs.mkdir(path.join(f.home, '.dsh-memex', 'not-library'))
  const r = f.run(['--days', '7'])
  assert.equal(r.status, 7, r.stderr)
  assert.deepEqual((await f.calls()).map(c => path.basename(c.args.at(-1))), ['a-fail', 'b-ok'])
  assert.match(r.stderr, /skipped 1 eval/)
})

test('memex explicit lib equals and help bypass empty default library root', async t => {
  const f = await fixture(t, 'memex-recall-report')
  await f.pkg(path.join(f.env.DSH_HOME, 'profiles', 'web', 'node_modules'), 'dsh-memex', 'dsh-memex-recall-report', 'lib/cli/recall-report.js')
  for (const args of [['--lib=eval-test'], ['--help']]) assert.equal(f.run(args).status, 0)
  assert.deepEqual((await f.calls()).map(c => c.args), [['--lib=eval-test'], ['--help']])
  const r = f.run()
  assert.equal(r.status, 1)
  assert.match(r.stderr, /no libraries|cannot read/i)
})

test('ws standalone helper resolves real PATH package entry and preserves failing argv', async t => {
  const f = await fixture(t, 'ws')
  const entry = await f.pkg(path.join(f.tools, 'node_modules'), 'dsh-worktree-session', 'dsh-ws', 'lib/cli.js')
  if (process.platform === 'win32') await fs.writeFile(path.join(f.tools, 'dsh-ws.cmd'), '@echo shim must never execute')
  else { await fs.symlink(entry, path.join(f.tools, 'dsh-ws'));await fs.chmod(entry, 0o755);f.env.PATH += path.delimiter + path.dirname(process.execPath) }
  f.env.SKILL_EXIT = '11'
  const args = ['status', '路径 & quote "', '']
  const r = f.run(args)
  assert.equal(r.status, 11, r.stderr)
  assert.deepEqual(await f.calls(), [{ args, cwd: f.cwd }])
})

test('memex PATH package takes precedence over profile fallback', async t => {
  const f = await fixture(t, 'memex-recall-report')
  const entry = await f.pkg(path.join(f.tools, 'node_modules'), 'dsh-memex', 'dsh-memex-recall-report', 'lib/cli/recall-report.js')
  if (process.platform === 'win32') await fs.writeFile(path.join(f.tools, 'dsh-memex-recall-report.cmd'), '@echo shim must never execute')
  else { await fs.symlink(entry, path.join(f.tools, 'dsh-memex-recall-report'));await fs.chmod(entry, 0o755) }
  const fallback = await f.pkg(path.join(f.env.DSH_HOME, 'profiles/web/node_modules'), 'dsh-memex', 'dsh-memex-recall-report', 'lib/cli/recall-report.js')
  await fs.writeFile(fallback, 'throw new Error("profile should not run")')
  const r = f.run(['--help'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(await f.calls(), [{ args: ['--help'], cwd: f.cwd }])
})

test('helpers fall back to built checkout using Git without Shell', async t => {
  for (const skill of ['ws', 'memex-recall-report']) {
    const f = await fixture(t, skill)
    const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path')
    let git
    for (const dir of (process.env[pathKey] || '').split(path.delimiter)) {
      const candidate = path.join(dir, process.platform === 'win32' ? 'git.exe' : 'git')
      try { if ((await fs.stat(candidate)).isFile()) { git = candidate; break } } catch {}
    }
    assert.ok(git, 'Git executable is a required fixture prerequisite')
    const init = spawnSync(git, ['init', '-q', f.cwd], { encoding: 'utf8' })
    assert.equal(init.status, 0, init.stderr)
    f.env.PATH += path.delimiter + path.dirname(git)
    const isWs = skill === 'ws'
    await f.pkg(path.join(f.cwd, 'packages'), isWs ? 'worktree-session' : 'dsh-memex', isWs ? 'dsh-ws' : 'dsh-memex-recall-report', isWs ? 'lib/cli.js' : 'lib/cli/recall-report.js')
    if (isWs) {
      const packageFile = path.join(f.cwd, 'packages/worktree-session/package.json')
      const p = JSON.parse(await fs.readFile(packageFile));p.name = 'dsh-worktree-session'
      await fs.writeFile(packageFile, JSON.stringify(p))
    }
    const r = f.run(['--help'])
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(await f.calls(), [{ args: ['--help'], cwd: f.cwd }])
  }
})

test('unknown Windows shim and invalid deployed package cannot run arbitrary files', async t => {
  for (const skill of ['ws', 'memex-recall-report']) {
    const f = await fixture(t, skill), isWs = skill === 'ws'
    const bin = isWs ? 'dsh-ws' : 'dsh-memex-recall-report'
    await fs.writeFile(path.join(f.tools, bin + '.cmd'), '@echo should never run')
    if (!isWs) {
      const base = path.join(f.env.DSH_HOME, 'profiles/web/node_modules/dsh-memex')
      await fs.mkdir(base, { recursive: true })
      await fs.writeFile(path.join(base, 'package.json'), JSON.stringify({ name: 'wrong-package', bin: { [bin]: 'outside.js' } }))
    }
    const r = f.run(['--help'])
    assert.equal(r.status, 1, r.stderr)
    assert.match(r.stderr, /not supported|not found|not installed/)
    await assert.rejects(fs.stat(f.log), { code: 'ENOENT' })
  }
})

test('missing helper CLI fails without installation or shell fallback', async t => {
  for (const skill of ['ws', 'memex-recall-report']) {
    const f = await fixture(t, skill)
    const r = f.run(['--help'])
    assert.equal(r.status, 1, r.stderr)
    assert.match(r.stderr, /not found|not installed|missing|not supported/i)
    await assert.rejects(fs.stat(f.log), { code: 'ENOENT' })
  }
})
