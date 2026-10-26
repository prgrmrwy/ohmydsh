// Black-box acceptance: commands execute the built CLI, not Vitest or source imports.
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Run from the repository root; this remains valid after OpenSpec archive moves the script.
const root = resolve(process.cwd())
const cli = join(root, 'packages/worktree-session/lib/cli.js')
const { startOperation, bindSource } = await import(pathToFileURL(join(root, 'packages/worktree-session/lib/host/operation.js')).href)
const exec = promisify(execFile)
const fixture = await mkdtemp(join(tmpdir(), 'ws-cli-acceptance-'))
const checks = []
const children = new Set()
async function git(cwd, ...args) { return (await exec('git', args, { cwd })).stdout }
async function command(action, path, extra = []) {
  try {
    const { stdout } = await exec(process.execPath, [cli, action, ...extra, path], { cwd: fixture, timeout: 40_000 })
    return { code: 0, data: JSON.parse(stdout) }
  } catch (error) {
    return { code: error.code, data: JSON.parse(error.stdout || error.stderr) }
  }
}
const pass = name => { checks.push(name); console.log(`PASS ${name}`) }
const absent = path => lstat(path).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error })
const waitFor = async path => {
  const deadline = Date.now() + 20_000
  while (await absent(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`)
    await new Promise(r => setTimeout(r, 20))
  }
}
async function make(name, hooks = {}) {
  const repo = join(fixture, name)
  await mkdir(repo)
  await git(repo, 'init', '-b', 'main'); await git(repo, 'config', 'user.email', 'acceptance@example.invalid'); await git(repo, 'config', 'user.name', 'Acceptance')
  await writeFile(join(repo, 'package.json'), '{"name":"fixture","version":"1.0.0"}')
  await writeFile(join(repo, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"fixture","version":"1.0.0"}}}')
  await writeFile(join(repo, '.gitignore'), '.env.local\nnode_modules/\n')
  await mkdir(join(repo, '.ws'))
  for (const [hook, body] of Object.entries(hooks)) await writeFile(join(repo, '.ws', hook), `#!/usr/bin/env node\n${body}`, { mode: 0o755 })
  await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'fixture')
  async function add(id) {
    const task = await startOperation({ operationId: `acceptance-${id}`, repoPath: repo, baseRef: 'main', taskText: id, dependencyMode: 'lean' })
    await bindSource({ operationId: task.operationId, repoPath: repo, sourceSessionId: `session-${id}` })
    return task
  }
  return { repo, add }
}
try {
  const plain = await make('plain')
  const task = await plain.add('plain-task')
  assert.equal((await command('prepare-preview', task.worktreePath)).data.preview.status, 'skipped')
  assert.equal((await command('status', task.worktreePath)).data.phase, 'prepared')
  pass('optional: repository without hooks remains usable, prepare returns skipped')

  const configured = await make('configured', { 'prepare-preview': `const fs=require('node:fs');fs.writeFileSync(process.env.WS_DSH_HOME+'/context.json',JSON.stringify({home:process.env.DSH_HOME,worktree:process.env.WS_WORKTREE,hook:process.env.WS_HOOK}));` })
  const ready = await configured.add('configured-task')
  assert(await absent(join(ready.dshHome, 'context.json')))
  await rm(ready.dshHome, { recursive: true })
  assert.equal((await command('prepare-preview', ready.worktreePath)).code, 0)
  const context = JSON.parse(await readFile(join(ready.dshHome, 'context.json')))
  assert.deepEqual(context, { home: ready.dshHome, worktree: ready.worktreePath, hook: 'prepare-preview' })
  assert.equal((await lstat(ready.dshHome)).mode & 0o777, 0o700)
  pass('opt-in and context: start runs no hook; missing home is safely recreated')

  const path = join(ready.worktreePath, '.ws/prepare-preview')
  await writeFile(path, '#!/usr/bin/env node\nprocess.exit(9)')
  const failed = await command('prepare-preview', ready.worktreePath)
  assert.equal(failed.code, 1); assert.equal(failed.data.preview.exitCode, 9)
  assert.equal((await command('status', ready.worktreePath)).data.preview.status, 'failed')
  await writeFile(path, '#!/usr/bin/env node\nconsole.log("retry ok")')
  assert.equal((await command('prepare-preview', ready.worktreePath)).data.preview.status, 'ok')
  pass('failure is nonzero and visible; retry succeeds without changing binding')

  const concurrent = await make('concurrent', { 'prepare-preview': `const fs=require('node:fs');fs.writeFileSync(process.env.WS_DSH_HOME+'/started','');setInterval(()=>{if(fs.existsSync(process.env.WS_DSH_HOME+'/release')) process.exit(0)},20)` })
  const a = await concurrent.add('concurrent-a')
  const child = spawn(process.execPath, [cli, 'prepare-preview', a.worktreePath], { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] }); children.add(child)
  let output = ''; child.stdout.on('data', b => { output += b })
  const ended = new Promise(r => child.on('exit', code => { children.delete(child); r(code) }))
  await waitFor(join(a.dshHome, 'started'))
  assert.notEqual((await command('prepare-preview', a.worktreePath)).code, 0)
  const b = await concurrent.add('concurrent-b')
  assert.equal((await command('promote', b.worktreePath)).code, 0)
  assert.equal((await command('clean', b.worktreePath)).data.cleaned, true)
  await writeFile(join(a.dshHome, 'release'), '')
  assert.equal(await ended, 0); assert.equal(JSON.parse(output).preview.status, 'ok')
  pass('concurrency: same-worktree duplicate refused; another worktree start/promote/clean completes')

  const cleanup = await make('cleanup', { 'teardown-preview': `require('node:fs').writeFileSync(process.env.WS_DSH_HOME+'/teardown-evidence',process.env.WS_HOOK);process.exit(7)` })
  const clean = await cleanup.add('cleanup-task')
  const dry = await command('clean', clean.worktreePath, ['--dry-run'])
  assert.equal(dry.data.cleaned, false); assert(await absent(join(clean.dshHome, 'teardown-evidence')))
  const done = await command('clean', clean.worktreePath)
  assert.equal(done.data.cleaned, true); assert.match(done.data.warnings.join('\n'), /teardown-preview failed/)
  assert(await absent(clean.worktreePath)); assert(await absent(clean.dshHome))
  pass('cleanup: dry-run has no side effects; failed teardown warns and cleanup removes home')

  const unsafe = await configured.add('unsafe-task')
  const status = (await command('status', unsafe.worktreePath)).data
  const common = (await git(configured.repo, 'rev-parse', '--git-common-dir')).trim()
  const recordPath = join(resolve(configured.repo, common), 'ws/operations', `${unsafe.operationId}.json`)
  const record = JSON.parse(await readFile(recordPath)); record.dshHome = configured.repo
  await writeFile(recordPath, JSON.stringify(record))
  const refusedHome = await command('clean', unsafe.worktreePath)
  assert.equal(refusedHome.data.isolatedHome.status, 'skipped'); assert((await lstat(configured.repo)).isDirectory())
  pass('unsafe deletion: home pointing at source repository is skipped, source survives')
  console.log(JSON.stringify({ verdict: 'PASS', checks: checks.length, details: checks, platform: process.platform, builtCli: cli }, null, 2))
} finally {
  for (const child of children) child.kill('SIGKILL')
  // fixture is created by mkdtemp above, never supplied by a caller.
  assert(fixture.startsWith(join(tmpdir(), 'ws-cli-acceptance-')))
  await rm(fixture, { recursive: true, force: true })
}
