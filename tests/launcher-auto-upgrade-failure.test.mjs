import assert from 'node:assert/strict'
import test from 'node:test'

test('launcher 的 auto-upgrade sync 失败分支恢复完整 manifest 并退出', async t => {
  const { createLauncherFixture } = await import('./helpers/launcher-fixture.mjs')
  const fixture = await createLauncherFixture(t, { scenario: { update: { enabled: true, status: 'update', current: '0.2.0-rc.2', latest: '0.2.0-rc.3', channel: 'latest' }, exit: { sync: 7 } } })
  const before = await fixture.read('dsh.yaml')
  const result = await fixture.run(['build'])
  assert.notEqual(result.status, 0)
  assert.equal(await fixture.read('dsh.yaml'), before)
  assert.equal(fixture.exists('dsh.yaml.bak'), false)
  assert.equal(result.calls.some(call => call.command === 'runtime'), false)
})
