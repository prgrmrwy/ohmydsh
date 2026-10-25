import test from 'node:test'
import assert from 'node:assert/strict'
import { createLauncherFixture } from './helpers/launcher-fixture.mjs'

// Trusted test programs call the frozen Bash capabilities; production source is
// never rewritten. P3 can replace this adapter without changing observations.
const SETUP = `
set -euo pipefail
for module in environment args runtime-server ui maintenance; do
  source "$REPO/scripts/launcher/$module.sh"
done
snapshot_launcher_environment
initialize_launcher_environment
initialize_launcher_args
initialize_server_runtime
mkdir -p "$DSH_HOME"
`
const fields = stdout => stdout.split('\0').filter((value, index, all) => index < all.length - 1)
async function atomic(t, script, { scenario, manifest, env, args = [] } = {}) {
  const fixture = await createLauncherFixture(t, { scenario, manifest, adapter: 'bash' })
  const result = await fixture.bash(SETUP + script, args, { env })
  return { fixture, ...result }
}
function ok(result) { assert.equal(result.status, 0, result.stderr || result.error?.message) }

// These are baseline same-semantics assertions, not tests for approved new P3
// behavior (strict dotenv, ownership-first start, or changed error handling).
test('atomic args preserve defaults, consumed web alias, port and host argument boundaries', async t => {
  const result = await atomic(t, `
parse_launcher_args "$@"
validate_launcher_args
printf '%s\\0' "$PORT" "$BUILD" "$BUILD_ONLY" "$NO_OPEN" "$OPEN" "$FOREGROUND" "\${PASSTHRU[@]}"
`, { args: ['web', '-b', '--foreground', '--open', '--no-open', '--port=41023', '--host', 'a b;$(not-a-command)', '--trusted-host=*.example'] })
  ok(result)
  assert.deepEqual(fields(result.stdout), ['41023', '1', '0', '1', '1', '1', '--host', 'a b;$(not-a-command)', '--trusted-host=*.example'])
})

test('atomic official invocation detector distinguishes plugin-update and preserves top-level priority', async t => {
  const result = await atomic(t, `
for mode in plugin plugin-update profile patch dump local; do
  case "$mode" in
    plugin) set -- plugin list ;;
    plugin-update) set -- plugin-update --dry-run ;;
    profile) set -- build --profile=other ;;
    patch) set -- history --patch /a ;;
    dump) set -- --dump-default-config ;;
    local) set -- build --no-open ;;
  esac
  if is_official_cli_invocation "$@"; then printf '%s:official\\n' "$mode"; else printf '%s:local\\n' "$mode"; fi
done
`)
  ok(result)
  assert.equal(result.stdout, 'plugin:official\nplugin-update:local\nprofile:official\npatch:official\ndump:official\nlocal:local\n')
})

test('atomic unknown arguments and orphan check reject before command effects', async t => {
  for (const args of [['--not-an-option'], ['--check']]) {
    const result = await atomic(t, 'parse_launcher_args "$@"\nvalidate_launcher_args\nprintf UNREACHABLE\n', { args })
    assert.equal(result.status, 1)
    assert.match(result.stderr, args[0] === '--check' ? /doctor/ : /无法识别的参数/)
    assert.equal(result.stdout, '')
    assert.deepEqual(result.calls, [])
  }
})

test('atomic registry injection is one-call only and explicit caller registry wins', async t => {
  for (const explicit of ['', 'https://user.example/']) {
    const result = await atomic(t, `
REPO_REGISTRY=https://repo.example/
DSH_USER_REGISTRY="$ATOMIC_EXPLICIT"
unset npm_config_registry
if [[ -n "$ATOMIC_EXPLICIT" ]]; then export npm_config_registry="$ATOMIC_EXPLICIT"; fi
with_repo_registry bash -c 'printf "%s\\0" "\${npm_config_registry-absent}"'
printf '%s\\0' "\${npm_config_registry-absent}"
`, { env: { ATOMIC_EXPLICIT: explicit } })
    ok(result)
    assert.deepEqual(fields(result.stdout), [explicit || 'https://repo.example/', explicit || 'absent'])
  }
})

test('atomic npm strip observer detects leaked variables and ignores ordinary environment', async t => {
  const observe = async mutation => atomic(t, `
export npm_config_registry=https://implicit.example/ npm_lifecycle_event=exec npm_package_name=fixture npm_command=exec npm_execpath=/synthetic/npm npm_node_execpath=/synthetic/node ORDINARY_VALUE=keep
${mutation ? 'server_env_strip_args() { :; }' : ''}
strip=()
while IFS= read -r -d '' arg; do strip+=("$arg"); done < <(server_env_strip_args)
env "\${strip[@]+"\${strip[@]}"}" bash -c 'printf "%s\\0" "\${npm_config_registry-absent}" "\${npm_lifecycle_event-absent}" "\${npm_package_name-absent}" "\${npm_command-absent}" "\${npm_execpath-absent}" "\${npm_node_execpath-absent}" "$ORDINARY_VALUE"'
`)
  const expected = ['absent', 'absent', 'absent', 'absent', 'absent', 'absent', 'keep']
  const good = await observe(false)
  ok(good)
  assert.deepEqual(fields(good.stdout), expected)
  const mutant = await observe(true)
  ok(mutant)
  assert.throws(() => assert.deepEqual(fields(mutant.stdout), expected), assert.AssertionError, 'same observer must reject a missing strip operation')
})

test('atomic runtime preparation accepts tagged metadata after installer noise', async t => {
  const result = await atomic(t, `
prepare_server_runtime
printf '%s\\0' "$PREPARED_DSH_VERSION" "$PREPARED_SERVER_BIN" "$PREPARED_RUNTIME_KIND" "$PREPARED_RUNTIME_OWNER" "$PREPARED_RUNTIME_COMPAT" "$PREPARED_RUNTIME_FINGERPRINT"
`, { scenario: { resolveNoise: true } })
  ok(result)
  const actual = fields(result.stdout)
  assert.equal(actual[0], '0.2.0-rc.2')
  assert.equal(actual[1], `${result.fixture.repo}/scripts/runtime.mjs`)
  assert.ok(!actual[1].includes('fixture installer output'))
  assert.deepEqual(actual.slice(2), ['fixture', 'fixture-owner', 'fixture-compat', 'fixture-fingerprint'])
  assert.equal(result.calls.filter(call => call.command === 'dsh-server-bin').length, 1)
  assert.equal(actual.length, 6)
})

test('atomic runtime resolver failure is nonzero and does not start a Host', async t => {
  const result = await atomic(t, 'prepare_server_runtime\nprintf UNREACHABLE\n', { scenario: { exit: { 'dsh-server-bin': 17 } } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /无法解析 DSH Host runtime/)
  assert.equal(result.stdout, '')
  assert.deepEqual(result.calls.map(call => call.command), ['dsh-server-bin'])
})

test('atomic stop cleans UI independently for every server outcome and never provisions', async t => {
  for (const status of [0, 1, 2, 3, 4]) {
    const result = await atomic(t, `
is_ui_open() { return 0; }
stop_dsh_server_on_port() { printf 'EFFECT:stop:%s\\n' "$1"; return "$ATOMIC_STOP_STATUS"; }
close_ui() { printf 'EFFECT:close-pwa\\n'; }
close_browser_ui_tabs() { printf 'EFFECT:close-tabs\\n'; }
do_stop
`, { env: { ATOMIC_STOP_STATUS: String(status) } })
    assert.equal(result.status, status < 2 ? 0 : 1)
    assert.deepEqual(result.stdout.split('\n').filter(line => line.startsWith('EFFECT:')), ['EFFECT:stop:3080', 'EFFECT:close-pwa', 'EFFECT:close-tabs'])
    assert.deepEqual(result.calls, [])
    if (status === 2) assert.match(result.stderr, /refusing to kill/)
    if (status === 3) assert.match(result.stderr, /lsof is required/)
    if (status === 4) assert.match(result.stderr, /did not stop/)
  }
})

test('atomic readiness polling has a finite budget and detects owned child early exit', async t => {
  const exhausted = await atomic(t, `
nc() { printf 'EFFECT:probe\\n' >> "$DSH_HOME/readiness-effects"; return 1; }
sleep() { printf 'EFFECT:sleep\\n' >> "$DSH_HOME/readiness-effects"; }
status=0
wait_for_port 41023 3 || status=$?
while IFS= read -r line; do printf '%s\\n' "$line"; done < "$DSH_HOME/readiness-effects"
exit "$status"
`)
  assert.equal(exhausted.status, 1)
  assert.equal(exhausted.stdout, 'EFFECT:probe\nEFFECT:sleep\n'.repeat(3))
  const exited = await atomic(t, `
kill() { return 1; }
nc() { printf UNREACHABLE; }
wait_for_port 41023 3 12345
`)
  assert.equal(exited.status, 2)
  assert.equal(exited.stdout, '')
})

test('atomic restart refuses a still-busy port after successful stop', async t => {
  const result = await atomic(t, `
do_stop() { printf 'EFFECT:stop\\n'; }
nc() { return 0; }
do_restart
`)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, 'EFFECT:stop\n')
  assert.match(result.stderr, /still busy after stopping/)
  assert.deepEqual(result.calls, [])
})

test('atomic UI no-open beats open and manifest without calling an opener', async t => {
  const result = await atomic(t, `
for flags in 00 01 10 11; do
  NO_OPEN="\${flags:0:1}"
  OPEN="\${flags:1:1}"
  ui_manifest_open_enabled() { printf 'EFFECT:manifest\\n'; return 1; }
  if ui_should_open; then printf '%s:open\\n' "$flags"; else printf '%s:closed\\n' "$flags"; fi
done
`)
  ok(result)
  assert.equal(result.stdout, 'EFFECT:manifest\n00:closed\n01:open\n10:closed\n11:closed\n')
  assert.deepEqual(result.calls, [])
})

test('atomic PWA discovery accepts one installed app and rejects ambiguity', async t => {
  const result = await atomic(t, `
mkdir -p "$HOME/Applications/Chrome Apps.localized/DeepSeek Harness.app"
pwa_app_of
mkdir -p "$HOME/Applications/Other DeepSeek Harness.app"
printf 'AMBIGUOUS:<%s>\\n' "$(pwa_app_of)"
`)
  ok(result)
  assert.equal(result.stdout, `${result.fixture.home}/Applications/Chrome Apps.localized/DeepSeek Harness.app\nAMBIGUOUS:<>\n`)
})

test('atomic history returns only the last twenty records', async t => {
  const result = await atomic(t, `
for n in $(seq 1 25); do printf 'record-%s\\n' "$n"; done > "$STARTUP_LOG"
do_history
`)
  ok(result)
  assert.equal(result.stdout, Array.from({ length: 20 }, (_, i) => `record-${i + 6}\n`).join(''))
  assert.deepEqual(result.calls, [])
})

test('atomic prerequisite failure is warned and logged but never blocks caller', async t => {
  const result = await atomic(t, `ensure_host_prerequisites\nprintf 'CONTINUED\\n'\n`, { scenario: { exit: { 'host-prerequisites': 19 } } })
  ok(result)
  assert.match(result.stdout, /CONTINUED/)
  assert.match(result.stderr, /dsh doctor/)
  assert.match(await result.fixture.read('home/dsh-startup.log'), /hostPrerequisites: failed \(exit 19\)/)
})

test('atomic autoupdate disabled, offline, dirty, and clean-update branches stay distinct', async t => {
  const cases = [
    { update: { enabled: false, status: 'update' }, dirty: false, expected: '' },
    { update: { enabled: true, status: 'offline', error: 'synthetic-offline' }, dirty: false, expected: /版本检测失败/ },
    { update: { enabled: true, status: 'update', current: '1.0.0', latest: '1.1.0', channel: 'latest' }, dirty: true, expected: /未提交改动/ },
    { update: { enabled: true, status: 'update', current: '1.0.0', latest: '1.1.0', channel: 'latest' }, dirty: false, expected: /EFFECT:upgrade/ },
  ]
  for (const scenario of cases) {
    const { expected, ...config } = scenario
    const result = await atomic(t, `do_autoupgrade() { printf 'EFFECT:upgrade\\n'; }\nautoupdate\n`, { scenario: config })
    ok(result)
    if (expected === '') assert.equal(result.stdout, '')
    else assert.match(result.stdout, expected)
    assert.equal(result.calls.filter(call => call.command === 'check-update').length, 1)
    assert.ok(result.calls.every(call => ['check-update', 'git'].includes(call.command)))
  }
})

test('atomic autoupgrade sync failure restores manifest and never commits', async t => {
  const fixture = await createLauncherFixture(t, { scenario: { exit: { sync: 23 } } })
  const original = await fixture.read('dsh.yaml')
  const result = await fixture.bash(SETUP + `
AU_CURRENT=0.2.0-rc.2
AU_LATEST=0.2.1
AU_CHANNEL=latest
AUTOUP_UPDATED=0
do_autoupgrade
printf UNREACHABLE
`)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /sync 失败/)
  assert.equal(await fixture.read('dsh.yaml'), original)
  assert.equal(fixture.exists('dsh.yaml.bak'), false)
  assert.deepEqual(result.calls.map(call => call.command), ['check-update', 'sync'])
})

test('atomic autoupgrade success preserves rewrite sync commit event ordering', async t => {
  const result = await atomic(t, `
AU_CURRENT=0.2.0-rc.2
AU_LATEST=0.2.1
AU_CHANNEL=next
AUTOUP_UPDATED=0
do_autoupgrade
printf 'UPDATED:%s\\n' "$AUTOUP_UPDATED"
`)
  ok(result)
  assert.match(result.stdout, /UPDATED:1/)
  assert.deepEqual(result.calls.map(call => call.command), ['check-update', 'sync', 'git', 'git'])
  assert.deepEqual(result.calls[0].argv, ['--rewrite-to', '0.2.1'])
  assert.deepEqual(result.calls[2].argv, ['-C', result.fixture.repo, 'add', 'dsh.yaml'])
  assert.deepEqual(result.calls[3].argv, ['-C', result.fixture.repo, 'commit', '--no-verify', '-m', 'chore(dsh): auto-bump 0.2.0-rc.2 → 0.2.1'])
  assert.match(await result.fixture.read('home/dsh-startup.log'), /autoUpdate: 0\.2\.0-rc\.2 -> 0\.2\.1 \(channel=next\)/)
  assert.equal(result.fixture.exists('dsh.yaml.bak'), false)
})

test('atomic autoupgrade commit failure exits without claiming update or logging success', async t => {
  const result = await atomic(t, `
AU_CURRENT=0.2.0-rc.2
AU_LATEST=0.2.1
AU_CHANNEL=latest
AUTOUP_UPDATED=0
do_autoupgrade
printf UNREACHABLE
`, { scenario: { exit: { git: 29 } } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /自动 commit 失败/)
  assert.doesNotMatch(result.stdout, /并提交|UNREACHABLE/)
  assert.match(await result.fixture.read('dsh.yaml'), /^dshVersion: 0\.2\.1$/m)
  assert.equal(result.fixture.exists('home/dsh-startup.log'), false)
})

test('atomic opener URL stays loopback and suppressed UI has no opener effect', async t => {
  for (const noOpen of [0, 1]) {
    const result = await atomic(t, `
PORT=41023
OPEN=1
NO_OPEN="$ATOMIC_NO_OPEN"
DSH_OPEN_APP=FixtureBrowser
PASSTHRU=(--host evil.example --trusted-host other.example)
open_ui
`, { env: { ATOMIC_NO_OPEN: String(noOpen) } })
    assert.equal(result.status, noOpen)
    const calls = result.calls.filter(call => call.command === 'open')
    assert.deepEqual(calls.map(call => call.argv), noOpen ? [] : [['-a', 'FixtureBrowser', 'http://127.0.0.1:41023']])
    assert.match(await result.fixture.read('home/dsh-ui.log'), noOpen ? /suppressed/ : /open app FixtureBrowser http:\/\/127\.0\.0\.1:41023/)
  }
})

test('atomic argument and UI observers reject deliberately broken test-only functions', async t => {
  const badArgs = await atomic(t, `
parse_launcher_args() { PORT=1; PASSTHRU=('deliberately-wrong'); }
parse_launcher_args --port=41023 --host 'a b'
printf '%s\\0' "$PORT" "\${PASSTHRU[@]}"
`)
  ok(badArgs)
  assert.throws(() => assert.deepEqual(fields(badArgs.stdout), ['41023', '--host', 'a b']), assert.AssertionError)
  const badUi = await atomic(t, `
ui_should_open() { return 0; }
NO_OPEN=1
OPEN=1
if ui_should_open; then printf OPENED; else printf SUPPRESSED; fi
`)
  ok(badUi)
  assert.throws(() => assert.equal(badUi.stdout, 'SUPPRESSED'), assert.AssertionError)
})

test('atomic autoupdate parser does not evaluate shell metacharacters in JSON fields', async t => {
  const marker = '$(printf INJECTED) `printf ALSO_INJECTED` " \\ $value'
  const result = await atomic(t, `
autoup_parse "$ATOMIC_UPDATE_JSON"
printf '%s\\0' "$AU_ERROR" "$AU_STATUS"
`, { env: { ATOMIC_UPDATE_JSON: JSON.stringify({ enabled: true, status: 'offline', error: marker }) } })
  ok(result)
  assert.deepEqual(fields(result.stdout), [marker, 'offline'])
  assert.deepEqual(result.calls, [])
})
