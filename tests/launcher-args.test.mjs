import test from 'node:test'
import assert from 'node:assert/strict'
const implementation = () => import('../scripts/launcher/args.mjs')
test('Node args retain local command flags and priority inputs', async () => {
  const { parseArgs, isOfficialInvocation } = await implementation()
  const parsed = parseArgs(['web','-b','--foreground','--port=40001','--host','two words','--trusted-host=x','--open','--no-open'])
  assert.equal(parsed.port, 40001)
  assert.equal(parsed.build, true)
  assert.equal(parsed.foreground, true)
  assert.equal(parsed.open, true)
  assert.equal(parsed.noOpen, true)
  assert.deepEqual(parsed.passthrough, ['--host','two words','--trusted-host=x'])
  assert.equal(isOfficialInvocation(['plugin','--profile','web','list']), true)
  assert.equal(isOfficialInvocation(['plugin-update','--dry-run']), false)
  assert.equal(isOfficialInvocation(['stop','--profile','web']), true)
})
test('Node invalid arguments reject synchronously before effects', async () => {
  const { parseArgs } = await implementation()
  for (const argv of [['--unknown'],['--check'],['--port'],['--host'],['--trusted-host'],['--port=0'],['--port=65536'],['--port=nan'],['--port=1.1'],['--port=']]) assert.throws(() => parseArgs(argv), /参数|port|value|--check|host/)
})
