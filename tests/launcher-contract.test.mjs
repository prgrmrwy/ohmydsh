import test from 'node:test'
import assert from 'node:assert/strict'
import { createLauncherFixture } from './helpers/launcher-fixture.mjs'

const CLI = new Set(['sync','host-prerequisites','check-update','plugin-update','dsh-cli','dsh-server-bin','runtime'])
const cliCalls = result => result.calls.filter(call => CLI.has(call.command))
function assertCalls(result, expected, status = 0) {
  assert.equal(result.status, status, result.stderr)
  assert.deepEqual(cliCalls(result).map(({command,argv}) => [command,argv]), expected)
}
const DISABLED_UPDATE = ['check-update', []]
const PREREQ = ['host-prerequisites', []]

test('contract assertion rejects wrong route, argv, unexpected side effects and lost exit status mutations', () => {
  const valid = { status: 0, stderr: '', calls: [{command:'sync',argv:[]}] }
  assertCalls(valid, [['sync',[]]])
  for (const mutant of [
    {...valid,calls:[{command:'runtime',argv:[]}]},
    {...valid,calls:[{command:'sync',argv:['--reset']}]},
    {...valid,calls:[...valid.calls,{command:'runtime',argv:[]}]},
    {...valid,status:7},
  ]) assert.throws(() => assertCalls(mutant, [['sync',[]]]), assert.AssertionError)
})

test('command contract catches a mutated sandbox subprocess rather than only a model result', async t => {
  const fixture = await createLauncherFixture(t)
  await fixture.write('scripts/sync.mjs', `import fs from 'node:fs';import path from 'node:path';const root=path.dirname(path.dirname(process.argv[1]));fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify({command:'runtime',argv:['unexpected-host'],cwd:process.cwd(),env:{}})+'\\n')`)
  const result = await fixture.run(['build'])
  assert.equal(result.status, 0, result.stderr)
  assert.throws(() => assertCalls(result, [DISABLED_UPDATE,PREREQ,['sync',[]]]), assert.AssertionError)
})

test('test_same_contract_across_bash_and_node', async t => {
  for (const adapter of ['bash', 'node']) {
    const fixture = await createLauncherFixture(t, { adapter })
    const result = await fixture.run(['doctor', '--check'])
    assertCalls(result, [['host-prerequisites', ['--check']]])
    assert.equal(result.calls[0].cwd, fixture.userCwd)
    await fixture.configure({ exit: { 'host-prerequisites': 7 } })
    assert.equal((await fixture.run(['doctor'])).status, 7)
  }
})

test('test_route_local_and_official_commands', async t => {
  const fixture = await createLauncherFixture(t)
  for (const [argv, expected] of [
    [['build'], [DISABLED_UPDATE, PREREQ, ['sync',[]]]],
    [['doctor','--check'], [['host-prerequisites',['--check']]]],
    [['plugin-update','--dry-run','--yes'], [['plugin-update',['--dry-run','--yes']]]],
    [['plugin','--profile','web','list'], [['dsh-cli',['plugin','--profile','web','list']]]],
    [['--dump-config'], [['dsh-cli',['--dump-config']]]],
    [['--patch','two words 中文 ;&()','--dump-default-config'], [['dsh-cli',['--patch','two words 中文 ;&()','--dump-default-config']]]],
  ]) {
    const result = await fixture.run(argv)
    assertCalls(result, expected)
    for (const call of cliCalls(result)) {
      assert.equal(call.cwd, fixture.userCwd, 'launcher must preserve caller cwd')
      assert.equal(call.env.FIXTURE_USER, 'kept')
      assert.equal(call.env.npm_config_registry, 'https://fixture.registry.invalid/')
    }
  }
  for (const [argv, command] of [[['doctor'],'host-prerequisites'],[['plugin-update'],'plugin-update'],[['plugin','list'],'dsh-cli'],[['build'],'sync']]) {
    await fixture.configure({exit:{[command]:7}})
    const result = await fixture.run(argv)
    assert.equal(result.status, 7, `${command}: ${result.stderr}`)
    assert.equal(result.calls.some(call => call.command === 'runtime'), false)
  }
})

test('test_stop_is_local_only', async t => {
  const fixture = await createLauncherFixture(t)
  const result = await fixture.run(['stop','--no-open'])
  assertCalls(result, [])
  assert.ok(result.calls.some(call => call.command === 'lsof'))
  assert.equal(result.calls.some(call => ['npm','npx','pnpm','corepack'].includes(call.command)), false)
  assert.match(result.stdout, /no dsh server found/)
})

test('history returns only last twenty startup lines and has no command side effects', async t => {
  const fixture = await createLauncherFixture(t)
  const lines = Array.from({length:25}, (_, index) => 'history-'+index)
  await fixture.write('home/dsh-startup.log', lines.join('\n')+'\n')
  const result = await fixture.run(['history'])
  assertCalls(result, [])
  assert.equal(result.stdout, lines.slice(-20).join('\n')+'\n')
  assert.deepEqual(result.calls, [])
})

test('reset preserves manifest and delegates exactly once without update or Host resolution', async t => {
  const fixture = await createLauncherFixture(t)
  const before = await fixture.read('dsh.yaml')
  assertCalls(await fixture.run(['reset']), [['sync',['--reset']]])
  assert.equal(await fixture.read('dsh.yaml'), before)
})

test('command combinations retain the recorded dispatch priority', async t => {
  const fixture = await createLauncherFixture(t)
  for (const [argv, expected] of [
    [['stop','history','doctor','reset','plugin-update','build'], []],
    [['history','doctor','reset','plugin-update','build'], []],
    [['doctor','reset','plugin-update','build'], [PREREQ]],
    [['reset','plugin-update','build'], [['sync',['--reset']]]],
    [['plugin-update','build'], [['plugin-update',[]]]],
    [['build','-b','restart'], [DISABLED_UPDATE,PREREQ,['sync',[]]]],
    [['stop','--profile','web'], [['dsh-cli',['stop','--profile','web']]]],
  ]) assertCalls(await fixture.run(argv), expected)
})

test('doctor failure is strict but automatic prerequisite healing only warns', async t => {
  const fixture = await createLauncherFixture(t, {scenario:{exit:{'host-prerequisites':9}}})
  assertCalls(await fixture.run(['doctor','--check']), [['host-prerequisites',['--check']]], 9)
  const result = await fixture.run(['build'])
  assertCalls(result, [DISABLED_UPDATE,PREREQ,['sync',[]]])
  assert.match(result.stderr, /warn:.*本机运行前提/)
  assert.match(await fixture.read('home/dsh-startup.log'), /hostPrerequisites: failed \(exit 9\)/)
})

test('autoUpdate offline and dirty states preserve pin and continue build without rewriting', async t => {
  const update = {enabled:true,status:'offline',current:'0.2.0-rc.2',latest:'0.2.0-rc.3',channel:'next',error:'fixture offline'}
  const fixture = await createLauncherFixture(t, {scenario:{update}})
  const before = await fixture.read('dsh.yaml')
  let result = await fixture.run(['build'])
  assertCalls(result, [DISABLED_UPDATE,PREREQ,['sync',[]]])
  assert.match(result.stdout, /warn:.*fixture offline/)
  assert.match(await fixture.read('home/dsh-startup.log'), /autoUpdate: offline/)
  await fixture.configure({update:{...update,status:'update'},dirty:true})
  result = await fixture.run(['build'])
  assertCalls(result, [DISABLED_UPDATE,PREREQ,['sync',[]]])
  assert.match(result.stdout, /已跳过自动更新/)
  assert.equal(await fixture.read('dsh.yaml'), before)
  assert.equal(fixture.exists('dsh.yaml.bak'), false)
  assert.equal(result.calls.some(call => call.command === 'git' && call.argv.includes('commit')), false)
})

test('autoUpdate successful rewrite sync commit occurs once and skips duplicate build', async t => {
  const fixture = await createLauncherFixture(t, {scenario:{update:{enabled:true,status:'update',current:'0.2.0-rc.2',latest:'0.2.0-rc.3',channel:'next'}}})
  const result = await fixture.run(['build'])
  assertCalls(result, [DISABLED_UPDATE,['check-update',['--rewrite-to','0.2.0-rc.3']],['sync',[]],PREREQ])
  const git = result.calls.filter(call => call.command === 'git')
  assert.deepEqual(git.map(call => call.argv.slice(2)), [
    ['status','--porcelain'],['status','--porcelain','--untracked-files=all'],['add','dsh.yaml'],['commit','--no-verify','-m','chore(dsh): auto-bump 0.2.0-rc.2 → 0.2.0-rc.3'],
  ])
  assert.match(await fixture.read('dsh.yaml'), /^dshVersion: 0\.2\.0-rc\.3/m)
  assert.match(await fixture.read('home/dsh-startup.log'), /autoUpdate: 0\.2\.0-rc\.2 -> 0\.2\.0-rc\.3 \(channel=next\)/)
  assert.equal(fixture.exists('dsh.yaml.bak'), false)
})

test('autoUpdate sync failure restores original manifest and never commits or starts Host', async t => {
  const fixture = await createLauncherFixture(t, {scenario:{update:{enabled:true,status:'update',current:'0.2.0-rc.2',latest:'0.2.0-rc.3',channel:'latest'},exit:{sync:7}}})
  const before = await fixture.read('dsh.yaml')
  const result = await fixture.run(['build'])
  assertCalls(result, [DISABLED_UPDATE,['check-update',['--rewrite-to','0.2.0-rc.3']],['sync',[]]], 1)
  assert.equal(await fixture.read('dsh.yaml'), before)
  assert.match(result.stderr, /回滚/)
  assert.equal(result.calls.some(call => call.command === 'git' && call.argv.includes('commit')), false)
})

test('already running server avoids update and resolution while -b still builds once', async t => {
  const fixture = await createLauncherFixture(t, {scenario:{portUp:true}})
  assertCalls(await fixture.run(['web','--no-open']), [])
  assertCalls(await fixture.run(['-b','--no-open']), [DISABLED_UPDATE,PREREQ,['sync',[]]])
})

test('restart replacement failure does not enter stop or spawn a replacement', async t => {
  const fixture = await createLauncherFixture(t, {scenario:{portUp:true,exit:{'dsh-server-bin':7}}})
  const result = await fixture.run(['restart'])
  assertCalls(result, [DISABLED_UPDATE,PREREQ,['dsh-server-bin',[]]], 1)
  assert.equal(result.calls.some(call => call.command === 'lsof'), false, 'stop must not begin before preparation succeeds')
  assert.match(result.stderr, /无法解析 DSH Host runtime/)
})

test('autoUpdate commit failure prevents prerequisites and Host start without claiming rollback', async t => {
  const fixture = await createLauncherFixture(t, {scenario:{update:{enabled:true,status:'update',current:'0.2.0-rc.2',latest:'0.2.0-rc.3',channel:'latest'},gitCommitExit:7}})
  const result = await fixture.run(['build'])
  assertCalls(result, [DISABLED_UPDATE,['check-update',['--rewrite-to','0.2.0-rc.3']],['sync',[]]], 1)
  assert.match(result.stderr, /自动 commit 失败/)
  assert.match(await fixture.read('dsh.yaml'), /^dshVersion: 0\.2\.0-rc\.3/m)
})

test('unknown arguments and orphan --check already reject without command effects', async t => {
  const fixture = await createLauncherFixture(t)
  for (const argv of [['--unknown'],['--check']]) {
    const result = await fixture.run(argv)
    assert.notEqual(result.status, 0)
    assert.deepEqual(result.calls, [])
    assert.match(result.stderr, /error:/)
  }
})

// Approved new semantics intentionally RED against the frozen Bash oracle.
// Ordinary node:test registration keeps unfinished acceptance visible; this is
// not a skip/todo, and P3 must turn the same assertion GREEN.
test('test_invalid_arguments_have_no_effects', async t => {
  const fixture = await createLauncherFixture(t)
  for (const argv of [['--unknown'],['--check'],['--port'],['--host'],['--port=0'],['--port=65536'],['--port=not-a-number']]) {
    await t.test(argv.join(' '), async () => {
      const result = await fixture.run(argv, {timeoutMs:2_000})
      assert.equal(result.signal, null, `${argv}: rejection must finish within budget`)
      assert.notEqual(result.status, 0, `${argv}: must reject`)
      assert.match(result.stderr, /(?:参数|--check|port|端口|value|requires)/i, `${argv}: actionable argument error`)
      assert.deepEqual(result.calls, [], `${argv}: argument validation must precede all command effects`)
    })
  }
})
