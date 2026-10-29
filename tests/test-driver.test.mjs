import test from 'node:test'
import assert from 'node:assert/strict'
import {testFiles} from '../scripts/test.mjs'
import path from 'node:path'
const portable=files=>files.map(file=>file.split(path.sep).join('/'))

test('portable root test driver retains all POSIX regression and selects native Windows contracts',()=>{
 const root=['legacy.test.mjs','launcher-ui.test.mjs','not-a-test.txt']
 assert.deepEqual(portable(testFiles('linux',root)),['tests/launcher-ui.test.mjs','tests/legacy.test.mjs'])
 const native=portable(testFiles('win32',root))
 for(const name of ['compat-launcher-policy','compat-launcher-publish','dsh-host-runtime'])assert.ok(native.includes(`tests/${name}.test.mjs`),'approved D8 safety suites must run in native Windows lane: '+name)
 assert.ok(native.includes('tests/launcher-ui.test.mjs'))
 assert.ok(native.includes('tests/launcher-runner.test.mjs'))
 assert.ok(native.includes('tests/workspace-lifecycle.test.mjs'))
 assert.ok(native.includes('tests/skill-execution.test.mjs'))
 assert.ok(native.includes('tests/platform/windows-launcher.test.mjs'))
 assert.ok(!native.includes('tests/launcher-cli-routing.test.mjs'),'historical Bash oracle remains in POSIX full regression')
 assert.ok(!native.includes('tests/platform/launcher-terminal.test.mjs'),'unfinished console-close is a separate red gate, not hidden as passed')
})
