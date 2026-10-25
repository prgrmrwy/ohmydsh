import test from 'node:test'
import assert from 'node:assert/strict'
const implementation = () => import('../scripts/launcher/process.mjs')

// Snapshots must bind a listener to a creation identity, not merely a PID or
// a familiar word appearing anywhere in a command string.
const owned = (overrides = {}) => ({
  pid: 1234, parentPid: 1000, created: 'creation-1',
  argv: ['/usr/bin/node', '/cache/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web', '--port', '40001'],
  ...overrides,
})

test('test_supported_dsh_argv_stops', async () => {
  const { isDshWebProcess } = await implementation()
  assert.equal(isDshWebProcess(owned(), 40001), true)
  assert.equal(isDshWebProcess(owned({ argv: ['/usr/bin/node', '/cache/node_modules/.bin/dsh', 'web', '--port=40001'] }), 40001), true)
})

test('darwin accepts bare-node ps argv using independently proven executable and a stable locale', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const path = await import('node:path'); const os = await import('node:os')
  const root = await mkdtemp(path.join(os.tmpdir(), 'darwin-owner 中文 '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const entry = path.join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  await mkdir(path.dirname(entry), { recursive: true }); await writeFile(entry, '')
  await writeFile(path.resolve(path.dirname(entry), '../package.json'), '{"name":"@deepseek-ai/dsh"}')
  const calls=[]
  const result=await (await implementation()).probePort(40001,{platform:'darwin',env:{LANG:'zh_CN.UTF-8'},run:async(command,args,options)=>{
    calls.push([command,args,options])
    if(command==='ps'){
    const displayed=options.env.LC_ALL==='en_US.UTF-8'?entry.replaceAll('\\','/'):entry.replaceAll('\\','/').replace('中文','M-dM-8M--M-fM^VM^G')
    return {status:0,stdout:`1000 Sat Oct 24 12:00:00 2026 node ${displayed} web --port 40001`}
   }
    return {status:0,stdout:args.includes('txt')?`p1234\nn${process.execPath}\n`:'1234\n'}
  }})
  assert.equal(result.state,'owned',result.error)
  assert.equal(calls.find(([name])=>name==='ps')[2].env.LC_ALL,'en_US.UTF-8')
  assert.equal(result.processes[0].executable,process.execPath)
})

test('darwin readable foreign ps command is unknown without signaling', async () => {
  const { probePort } = await implementation()
  const result = await probePort(40001, { platform: 'darwin', run: async command => command === 'ps'
    ? { status: 0, stdout: '1000 Sun Oct 25 12:00:00 2026 /usr/bin/node /tmp/foreign.mjs web --port 40001' }
    : { status: 0, stdout: '1234\n' } })
  assert.equal(result.state, 'unknown')
  assert.equal(result.processes[0].pid, 1234)
})

test('test_foreign_listener_is_untouched', async () => {
  const { isDshWebProcess } = await implementation()
  for (const argv of [
    ['/usr/bin/node', '/tmp/foreign.js', 'web', '--port', '40001'],
    ['/usr/bin/node', '-e', 'console.log("/cache/node_modules/@deepseek-ai/dsh/lib/bin.js web")'],
    ['/usr/bin/node', '/cache/node_modules/@deepseek-ai/dsh/lib/bin.js', 'plugin', '--port', '40001'],
    ['/usr/bin/node', '/cache/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web', '--port', '40002'],
  ]) assert.equal(isDshWebProcess(owned({ argv }), 40001), false, JSON.stringify(argv))
})

test('test_unknown_or_reused_identity_refuses_signal', async () => {
  const { sameProcessIdentity } = await implementation()
  assert.equal(sameProcessIdentity(owned(), owned()), true)
  assert.equal(sameProcessIdentity(owned(), owned({ created: 'creation-2' })), false)
  assert.equal(sameProcessIdentity(owned(), owned({ created: '' })), false)
  assert.equal(sameProcessIdentity(owned(), owned({ pid: 5678 })), false)
  assert.equal(sameProcessIdentity(owned(), owned({ argv: ['foreign'] })), false)
})

test('test_invisible_listener_is_unknown', async () => {
  const { classifyPort } = await implementation()
  assert.equal(classifyPort([], false, 40001).state, 'empty')
  assert.equal(classifyPort([], true, 40001).state, 'unknown')
  assert.equal(classifyPort([owned()], true, 40001).state, 'owned')
  assert.equal(classifyPort([owned({ created: '' })], true, 40001).state, 'unknown')
  assert.equal(classifyPort([owned(), owned({ pid: 5678, argv: ['foreign'] })], true, 40001).state, 'unknown')
})

test('stop revalidates identity immediately before signaling and refuses changed owner', async () => {
  const { stopServer } = await implementation()
  const calls = []
  let reads = 0
  const result = await stopServer(40001, {
    probe: async () => ({ state: 'owned', processes: [owned({ created: ++reads === 1 ? 'creation-1' : 'creation-2' })] }),
    signal: async (...args) => calls.push(args),
  })
  assert.equal(result.ok, false)
  assert.deepEqual(calls, [])
})

test('stop verifies all listeners before any signal and refuses unknown states', async () => {
  const { stopServer } = await implementation()
  for (const state of ['unknown', 'probe-error']) {
    const calls = []
    const result = await stopServer(40001, { probe: async () => ({ state, processes: [] }), signal: async (...args) => calls.push(args) })
    assert.equal(result.ok, false)
    assert.deepEqual(calls, [])
  }
  assert.equal((await stopServer(40001, { probe: async () => ({ state: 'empty', processes: [] }) })).ok, true)
})

test('POSIX stop sends TERM and succeeds only after an empty final ownership check', async () => {
  const { stopServer } = await implementation()
  const calls = []; let reads = 0
  const result = await stopServer(40001, {
    platform: 'linux',
    probe: async () => (++reads < 3 ? { state: 'owned', processes: [owned()] } : { state: 'empty', processes: [] }),
    connect: async () => false,
    signal: async (...args) => calls.push(args),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [[1234, 'SIGTERM']])
  assert.equal(reads, 3)
})

test('Windows stop uses argv taskkill only for revalidated identity and diagnoses force', async () => {
  const { stopServer } = await implementation()
  const calls = []; const warnings = []; let reads = 0
  const result = await stopServer(40001, {
    platform: 'win32',
    probe: async () => (++reads < 3 ? { state: 'owned', processes: [owned()] } : { state: 'empty', processes: [] }),
    connect: async () => false,
    run: async (...args) => { calls.push(args); return { status: 0 } },
    warn: value => warnings.push(value),
  })
  assert.equal(result.ok, true)
  assert.equal(calls[0][0], 'taskkill.exe')
  assert.deepEqual(calls[0][1], ['/PID', '1234', '/T', '/F'])
  assert.match(warnings.join(''), /强制|force/i)
})

test('probe errors and invisible listeners never classify as empty', async () => {
  const { probePort } = await implementation()
  const missing = await probePort(40001, { platform: 'linux', run: async () => ({ status: null, error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }), connect: async () => false })
  assert.equal(missing.state, 'probe-error')
  assert.match(missing.error, /lsof/)
  const invisible = await probePort(40001, { platform: 'linux', run: async () => ({ status: 1, stdout: '', stderr: '' }), connect: async () => true })
  assert.equal(invisible.state, 'unknown')
})

test('Windows probe executes one fixed encoded query and rejects malformed output', async () => {
  const { probePort } = await implementation()
  const calls = []
  const result = await probePort(40001, { platform: 'win32', run: async (...args) => { calls.push(args); return { status: 0, stdout: 'not-json' } }, connect: async () => false })
  assert.equal(result.state, 'probe-error')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'powershell.exe')
  assert.deepEqual(calls[0][1].slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
})

test('expired stop deadline and taskkill not-found never imply a stopped listener', async () => {
  const { stopServer } = await implementation()
  const calls = []
  const expired = await stopServer(40001, { deadline: Date.now() - 1, probe: async () => ({ state: 'owned', processes: [owned()] }), signal: async (...args) => calls.push(args) })
  assert.equal(expired.ok, false)
  assert.deepEqual(calls, [])
  const missing = await stopServer(40001, { platform: 'win32', probe: async () => ({ state: 'owned', processes: [owned()] }), run: async () => ({ status: 128 }), warn: () => {} })
  assert.equal(missing.ok, false)
})

if (process.platform !== 'win32') test('real POSIX probe verifies package identity, refuses a foreign listener, and stops its owned fixture', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { spawn } = await import('node:child_process')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const net = await import('node:net')
  const { once } = await import('node:events')
  const { probePort, stopServer } = await implementation()
  const dir = await mkdtemp(path.join(tmpdir(), 'launcher ownership 中文 '))
  const children = []
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed.catch(() => {}) }
    await rm(dir, { recursive: true, force: true })
  })
  const pkg = path.join(dir, 'node_modules/@deepseek-ai/dsh')
  await mkdir(path.join(pkg, 'lib'), { recursive: true })
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2', type: 'module' }))
  const program = `import net from 'node:net'; const port=Number(process.argv[process.argv.indexOf('--port')+1]);net.createServer(c=>c.end()).listen(port,'127.0.0.1',()=>console.log('READY'));\n`
  await writeFile(path.join(pkg, 'lib/bin.js'), program)
  await writeFile(path.join(dir, 'foreign.mjs'), program)
  async function listener(entry) {
    const reserve = net.createServer().listen(0, '127.0.0.1')
    await once(reserve, 'listening')
    const port = reserve.address().port
    await new Promise(resolve => reserve.close(resolve))
    const child = spawn(process.execPath, [entry, 'web', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('fixture exited before readiness') })])
    return { child, port }
  }
  const foreign = await listener(path.join(dir, 'foreign.mjs'))
  assert.equal((await probePort(foreign.port)).state, 'unknown')
  assert.equal((await stopServer(foreign.port)).ok, false)
  assert.equal(foreign.child.exitCode, null)
  const own = await listener(path.join(pkg, 'lib/bin.js'))
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'foreign-name', type: 'module' }))
  assert.equal((await probePort(own.port)).state, 'unknown', 'familiar entry suffix cannot substitute for package identity')
  await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', type: 'module' }))
  const record = await probePort(own.port)
  assert.equal(record.state, 'owned', record.error)
  assert.equal(record.processes[0].pid, own.child.pid)
  assert.equal((await stopServer(own.port)).ok, true)
  assert.equal((await probePort(own.port)).state, 'empty')
})

test('Windows process command line parser preserves MSVCRT quoting and trailing backslash', async () => {
  const { parseWindowsCommandLine, isDshWebProcess } = await implementation()
  const argv = parseWindowsCommandLine(String.raw`"C:\Program Files\node.exe" "C:\cache path\node_modules\@deepseek-ai\dsh\lib\bin.js" web --port 40001 "" "a\"b" "C:\tail\\"`)
  assert.deepEqual(argv, ['C:\\Program Files\\node.exe', 'C:\\cache path\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js', 'web', '--port', '40001', '', 'a"b', 'C:\\tail\\'])
  assert.equal(isDshWebProcess(owned({ argv }), 40001, { platform: 'win32' }), true)
})
