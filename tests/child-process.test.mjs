import test from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { spawn, spawnSync, execFile } from '../scripts/lib/child-process.mjs'

test('subprocess defaults hide consoles and preserve options and overloads', t => {
  for (const [name, wrapped] of [['spawn', spawn], ['spawnSync', spawnSync], ['execFile', execFile]]) {
    const calls = []
    const result = { pid: 123 }
    t.mock.method(childProcess, name, (...args) => { calls.push(args); return result })
    const options = { cwd: 'space 中文', env: { ONLY: 'value' }, stdio: 'inherit', timeout: 42 }
    assert.equal(wrapped('tool', ['a&b', ''], options), result)
    assert.deepEqual(calls.pop().slice(0, 3), ['tool', ['a&b', ''], { windowsHide: true, ...options }])
    wrapped('tool', [], { windowsHide: false })
    assert.equal(calls.pop()[2].windowsHide, false)
    wrapped('tool', options)
    const call = calls.pop()
    assert.deepEqual(name === 'execFile' ? call[2] : call[1], { windowsHide: true, ...options })
    wrapped('tool')
    const omitted = calls.pop()
    assert.deepEqual(name === 'execFile' ? omitted[2] : omitted[1], { windowsHide: true })
    if (name === 'execFile') {
      const callback = () => {}
      wrapped('tool', callback)
      assert.equal(calls.pop()[3], callback)
      wrapped('tool', ['arg'], callback)
      assert.equal(calls.pop()[3], callback)
      wrapped('tool', options, callback)
      assert.equal(calls.pop()[3], callback)
    }
  }
})

test('sync wrapper preserves literal argv, captured streams and failure status', () => {
  const argv = ['space 中文', 'a&b', '"quoted"', '']
  const result = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1))); console.error("diagnostic"); process.exitCode=7', ...argv], { encoding: 'utf8' })
  assert.equal(result.status, 7)
  assert.deepEqual(JSON.parse(result.stdout), argv)
  assert.equal(result.stderr.trim(), 'diagnostic')
})

test('async wrapper forwards callback stdout and stderr', async () => {
  await new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', 'console.log("ok"); console.error("detail")'], { encoding: 'utf8' }, (error, stdout, stderr) => {
      try {
        assert.equal(error, null)
        assert.equal(stdout.trim(), 'ok')
        assert.equal(stderr.trim(), 'detail')
        resolve()
      } catch (failure) { reject(failure) }
    })
  })
})

test('configuration entrypoints use shared subprocess defaults', async () => {
  for (const file of ['bootstrap', 'sync', 'host-prerequisites', 'dsh-cli', 'plugin-update']) {
    const source = await readFile(new URL('../scripts/' + file + '.mjs', import.meta.url), 'utf8')
    assert.match(source, /from '\.\/lib\/child-process\.mjs'/, file)
    assert.doesNotMatch(source, /from 'node:child_process'/, file)
  }
})
