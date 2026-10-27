import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { cp, rm, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { overlayFixture, snapshotTree } from './helpers/overlay-fixture.mjs'

const root = new URL('../', import.meta.url).pathname
const skill = path.join(root, 'skills/case-verify')
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' })
function pythonSupported(text) {
  const m = /Python (\d+)\.(\d+)/.exec(text)
  return !!m && (+m[1] > 3 || +m[1] === 3 && +m[2] >= 9)
}
const supported = pythonSupported(python.stdout || '')

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === '__pycache__' ? [] : e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])
}
function hosts(text) {
  return [...text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)(?=[:/\s'"`<]|$)/g)].map(m => m[1])
}
function allowed(host) {
  return ['example.com', 'localhost', '127.0.0.1', 'figma.com', 'github.com'].includes(host) || host.endsWith('.example')
}

const manifest = enabled => `dshVersion: 0.1.0-rc.7\ndependencies: []\ncustomizations:\n  - id: case-verify\n    type: skill\n    enabled: ${enabled}\n`
async function deployed(t) {
  const fx = await overlayFixture({ manifest: manifest(true) })
  t.after(async () => { assert.ok(fx.root.startsWith('/')); await rm(fx.root, { recursive: true, force: true }) })
  await cp(skill, path.join(fx.repo, 'skills/case-verify'), { recursive: true, filter: p => !p.includes('__pycache__') })
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return fx
}
test('test_cv_048', async t => {
  const publicManifest = readFileSync(path.join(root, 'dsh.yaml'), 'utf8')
  assert.match(publicManifest, /- id: case-verify\n\s+type: skill\n\s+enabled: true/)
  const fx = await deployed(t)
  assert.equal(readFileSync(path.join(fx.dshHome, 'skills/case-verify/SKILL.md'), 'utf8'), readFileSync(path.join(skill, 'SKILL.md'), 'utf8'))
  const before = await snapshotTree(fx.dshHome)
  const second = fx.sync()
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
  assert.match(second.stdout, /case-verify up-to-date/)
})

test('test_cv_049', async t => {
  const fx = await deployed(t)
  const before = await snapshotTree(path.join(fx.repo, 'skills/case-verify'))
  await fx.putPublic('dsh.yaml', manifest(false))
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(existsSync(path.join(fx.dshHome, 'skills/case-verify')), false)
  assert.deepEqual(await snapshotTree(path.join(fx.repo, 'skills/case-verify')), before)
})

test('test_cv_050', () => {
  for (const f of files(skill).filter(f => /\.(md|py|yaml)$/.test(f))) {
    for (const host of hosts(readFileSync(f, 'utf8'))) assert.ok(allowed(host), `${f}: ${host}`)
  }
})

test('test_cv_051', () => {
  const invalid = hosts('https://qa.corp-internal.test/case/1').filter(h => !allowed(h))
  assert.deepEqual(invalid, ['qa.corp-internal.test'])
})

test('test_cv_065', t => {
  if (!supported) return t.skip('Python 3.9+ required')
  const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', path.join(skill, 'tests')], { encoding: 'utf8', cwd: root })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('test_cv_066', () => {
  for (const text of ['', 'Python 3.8.9']) {
    assert.equal(pythonSupported(text), false)
    const program = `import test from 'node:test'; const supported=(${pythonSupported.toString()})(${JSON.stringify(text)}); test('python wrapper',t=>{if(!supported)return t.skip('Python 3.9+ required'); throw Error('must not run')})`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Python 3.9\+ required/)
    assert.match(result.stdout, /skipped 1/)
    assert.match(result.stdout, /pass 0/)
  }
})

test('test_cv_067', () => {
  if (!supported) return
  const program = `import test from 'node:test'; import assert from 'node:assert/strict'; import {spawnSync} from 'node:child_process'; test('python failure propagation',()=>{const r=spawnSync('python3',['-c','raise AssertionError("synthetic failure")']);assert.equal(r.status,0)})`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /python failure propagation/)
})

test('test_cv_068', async t => {
  if (!supported) return t.skip('Python 3.9+ required')
  const check = directory => spawnSync('python3', ['-B', '-c', `import ast,sys,pathlib
root=pathlib.Path(sys.argv[1]); local={p.stem for p in root.glob('*.py')}
allowed=set(getattr(sys,'stdlib_module_names',{'argparse','ast','contextlib','datetime','fcntl','hashlib','http','json','mimetypes','os','pathlib','re','shutil','socket','subprocess','sys','tempfile','threading','time','typing','urllib','uuid'}))|local
for p in root.glob('*.py'):
 for n in ast.walk(ast.parse(p.read_text())):
  names=[a.name.split('.')[0] for a in n.names] if isinstance(n,ast.Import) else [n.module.split('.')[0]] if isinstance(n,ast.ImportFrom) and n.module else []
  for name in names: assert name in allowed,(str(p),name)
assert 'yaml' not in allowed
`, directory], { encoding: 'utf8' })
  const result = check(path.join(skill, 'scripts'))
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'case-verify-import-'))
  t.after(async () => { assert.ok(fixture.startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(fixture, { recursive: true, force: true }) })
  await writeFile(path.join(fixture, 'forbidden.py'), 'import yaml\n')
  const forbidden = check(fixture)
  assert.notEqual(forbidden.status, 0)
  assert.match(forbidden.stderr, /forbidden\.py.*yaml/)
})
