import test from 'node:test'
import assert from 'node:assert/strict'
import { closeUi } from '../../scripts/launcher/ui.mjs'

// Native surface acceptance must additionally run with an installed PWA and a
// same-port Chrome tab; this argv contract does not pretend to open/close them.
test('macOS cleanup sends bounded PWA quit before same-port Chrome tab cleanup', async () => {
  assert.equal(process.platform, 'darwin', 'run this platform suite only on macOS')
  const calls = []
  await closeUi({ port: 41023, env: { DSH_OPEN_APP: 'DeepSeek Harness' }, run: async (...args) => { calls.push(args); return { status: 0 } } })
  assert.equal(calls.length, 2)
  assert.ok(calls.every(([command, , options]) => command === 'osascript' && options.timeoutMs <= 3000))
  assert.equal(calls[0][1].at(-1), 'DeepSeek Harness')
  assert.equal(calls[1][1].at(-1), '41023')
})
