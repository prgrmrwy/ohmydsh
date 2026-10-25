import test from 'node:test'
import assert from 'node:assert/strict'
const implementation = () => import('../scripts/launcher/ui.mjs')

test('test_default_open_happens_once', async () => {
  const { shouldOpenUi } = await implementation()
  assert.equal(shouldOpenUi({}, {}), true)
})

test('test_manifest_no_open_for_all_start_paths', async () => {
  const { shouldOpenUi } = await implementation()
  for (const action of ['start', 'reuse', 'restart']) assert.equal(shouldOpenUi({ web: { open: false } }, { action }), false)
})

test('test_no_open_beats_open_and_manifest', async () => {
  const { shouldOpenUi } = await implementation()
  for (const open of [true, false]) {
    assert.equal(shouldOpenUi({ web: { open } }, { open: true }), true)
    assert.equal(shouldOpenUi({ web: { open } }, { noOpen: true }), false)
    assert.equal(shouldOpenUi({ web: { open } }, { open: true, noOpen: true }), false)
  }
})

test('test_opener_failure_keeps_host_and_prints_url', async () => {
  const { openUi } = await implementation()
  const calls = []; const warnings = []
  const result = await openUi({ port: 40001, platform: 'linux', env: {}, run: async (...args) => { calls.push(args); return { status: 7 } }, warn: value => warnings.push(value) })
  assert.equal(result.opened, false)
  assert.equal(result.url, 'http://127.0.0.1:40001')
  assert.equal(calls[0][0], 'xdg-open')
  assert.deepEqual(calls[0][1], ['http://127.0.0.1:40001'])
  assert.match(warnings.join('\n'), /http:\/\/127\.0\.0\.1:40001/)
  assert.equal(calls.some(([command]) => /kill|stop/.test(command)), false)
})

test('test_non_darwin_stop_preserves_browser', async () => {
  const { closeUi } = await implementation()
  for (const platform of ['linux', 'win32']) {
    const calls = []; const warnings = []
    await closeUi({ port: 40001, platform, env: {}, run: async (...args) => { calls.push(args); return { status: 0 } }, warn: value => warnings.push(value) })
    assert.deepEqual(calls, [])
    assert.match(warnings.join('\n'), /手动|manual/i)
  }
})

test('macOS app names are AppleScript argv, never interpolated source text', async () => {
  const { closeUi } = await implementation()
  const calls = []
  const malicious = 'Fixture"; do shell script "touch marker'
  await closeUi({ port: 40001, platform: 'darwin', env: { DSH_OPEN_APP: malicious }, run: async (...args) => { calls.push(args); return { status: 0, stdout: '' } } })
  const apple = calls.filter(([command]) => command === 'osascript')
  assert.equal(apple.length, 2)
  assert.equal(apple[0][1].at(-1), malicious)
  assert.ok(!apple[0][1][1].includes(malicious))
  assert.equal(apple[1][1].at(-1), '40001')
  assert.ok(apple.every(([, , options]) => options.timeoutMs <= 3000))
})

test('macOS never quits an explicitly configured whole browser', async () => {
  const { closeUi } = await implementation()
  const calls=[]
  await closeUi({port:40001,platform:'darwin',env:{DSH_OPEN_APP:'/Applications/Google Chrome.app'},run:async(...args)=>{calls.push(args);return {status:0}},warn:()=>{}})
  assert.equal(calls.length,1)
  assert.equal(calls[0][1].at(-1),'40001')
  assert.doesNotMatch(calls[0][1][1],/tell application appName to quit/)
})

test('Windows opener uses a fixed encoded script and only a constructed URL', async () => {
  const { openUi } = await implementation()
  const calls = []; const warnings = []
  const result = await openUi({ port: 40001, platform: 'win32', env: { DSH_OPEN_APP: 'Mac app' }, run: async (...args) => { calls.push(args); return { status: 0 } }, warn: value => warnings.push(value) })
  assert.equal(result.opened, true)
  assert.equal(calls[0][0], 'powershell.exe')
  const source = Buffer.from(calls[0][1].at(-1), 'base64').toString('utf16le')
  assert.match(source, /http:\/\/127\.0\.0\.1:40001/)
  assert.doesNotMatch(source, /Mac app/)
  assert.match(warnings.join(''), /DSH_OPEN_APP/)
})

test('invalid opener ports reject before any effect', async () => {
  const { openUi } = await implementation()
  for (const port of [0, 65536, 'x;&', 1.5]) {
    let calls = 0
    await assert.rejects(openUi({ port, run: async () => { calls++; return { status: 0 } } }), /port/i)
    assert.equal(calls, 0)
  }
})

test('opener URL never incorporates host or trusted-host input', async () => {
  const { openUi } = await implementation()
  const calls = []
  await openUi({ port: 40001, host: 'evil.example', trustedHost: 'x;&', platform: 'linux', env: {}, run: async (...args) => { calls.push(args); return { status: 0 } } })
  assert.deepEqual(calls[0][1], ['http://127.0.0.1:40001'])
})
