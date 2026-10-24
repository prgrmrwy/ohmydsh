import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = ['args', 'environment', 'runtime-server', 'ui', 'maintenance']
const ORACLE = path.join(ROOT, 'tests/fixtures/launcher-bash-baseline')

// Historical source-purity tests below target the frozen Bash oracle, not Node.
test('product legacy entry forwards only to Node and no Bash dispatch modules remain', async () => {
  const wrapper = await readFile(path.join(ROOT, 'bin/dsh'), 'utf8')
  assert.match(wrapper, /exec node .*dsh\.mjs/)
  assert.doesNotMatch(wrapper, /source |parse_launcher_args|start_server|do_stop|autoUpdate/)
  assert.equal((await readdir(path.join(ROOT, 'scripts/launcher'))).some(name => name.endsWith('.sh')), false)
})

// DEBUG runs before even a builtin/assignment/redirection. Reject rather than run
// any source-time command, so a broken module cannot contact real tools/services.
function sourceOnly(files) {
  return spawnSync('bash', ['--noprofile', '--norc', '-c', `
set -euo pipefail
set -T
source_guard() {
  case "$BASH_COMMAND" in
    'source "$@"'|'trap - DEBUG') ;;
    *) printf 'source-time command: %s\\n' "$BASH_COMMAND" >&2; exit 97 ;;
  esac
}
trap source_guard DEBUG
source "$@"
trap - DEBUG
`, 'source-only', ...files], { encoding: 'utf8', timeout: 5_000, env: { PATH: process.env.PATH } })
}

function assertSourceOnly(result) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '', 'sourcing must not print or dispatch')
  assert.equal(result.stderr, '', 'sourcing must not print or dispatch')
}

test('source-only guard accepts definitions without executing their bodies', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ohmydsh-source-only-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'definitions.sh')
  await writeFile(file, 'initialize() { STATE=initialized; npm install; curl https://invalid.example; node host.mjs; open http://127.0.0.1:1; }\n')
  assertSourceOnly(sourceOnly([file]))
})

test('source-only assertion rejects npm/network/Host/UI and builtin initialization mutations before execution', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ohmydsh-source-mutation-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const [name, command] of Object.entries({
    npm: 'npm install', network: 'curl https://invalid.example', host: 'node host.mjs',
    ui: 'open http://127.0.0.1:1', assignment: 'STATE=initialized',
    redirect: ': > "$HOME/source-side-effect"', call: 'initialize',
  })) {
    const file = path.join(dir, `${name}.sh`)
    await writeFile(file, `initialize() { :; }\n${command}\n`)
    const result = sourceOnly([file])
    assert.equal(result.status, 97, `${name}: ${result.stderr}`)
    assert.match(result.stderr, /source-time command:/)
    assert.throws(() => assertSourceOnly(result), assert.AssertionError, `${name}: assertion must catch mutation`)
  }
})

test('launcher capability modules contain only inert function definitions when sourced', async () => {
  for (const name of MODULES) {
    const file = path.join(ORACLE, 'scripts/launcher', `${name}.sh`)
    const source = await readFile(file, 'utf8').catch(() => '')
    assert.ok(source.includes('() {'), `${name}: launcher requires an explicit callable module boundary`)
    assertSourceOnly(sourceOnly([file]))
  }
})

test('legacy executable local configuration keeps entry argv and may select a command', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ohmydsh-env-entry-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'bin'))
  await mkdir(path.join(dir, 'scripts/lib'), { recursive: true })
  await cp(path.join(ORACLE, 'bin/dsh'), path.join(dir, 'bin/dsh'))
  await cp(path.join(ORACLE, 'scripts/launcher'), path.join(dir, 'scripts/launcher'), { recursive: true })
  await cp(path.join(ORACLE, 'scripts/lib/dsh-runtime.sh'), path.join(dir, 'scripts/lib/dsh-runtime.sh'))
  await writeFile(path.join(dir, '.env.local'), 'printf "CONFIG_ARG:%s\\n" "$@"\nset -- history\n')
  const result = spawnSync('bash', [path.join(dir, 'bin/dsh'), '--original', 'two words'], {
    encoding: 'utf8', timeout: 5_000,
    env: { PATH: process.env.PATH, HOME: dir, DSH_HOME: path.join(dir, 'home') },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'CONFIG_ARG:--original\nCONFIG_ARG:two words\nno startup history yet (run dsh to start one)\n')
})
