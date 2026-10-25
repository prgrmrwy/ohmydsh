import test from 'node:test'
import assert from 'node:assert/strict'
import { terminalFixture, runProcess, CLOSE_POSIX_TERMINAL, closeWindowsTerminal } from '../helpers/terminal-fixture.mjs'
import { probePort } from '../../scripts/launcher/process.mjs'

// Native platform acceptance, deliberately not part of the historical Bash suite.
// Unsupported automation remains RED, never skip/todo or a taskkill simulation.
test('test_host_survives_real_terminal_close',async t=>{
  const fixture=await terminalFixture(t)
  if(process.platform==='win32'){
    const result=await closeWindowsTerminal(fixture)
    assert.equal(result.consoleEvent,'2','must observe CTRL_CLOSE_EVENT, not killed parent tree')
    const after=await probePort(fixture.port)
    assert.equal(after.state,'owned')
    assert.equal(after.processes[0].pid,result.before.processes[0].pid)
    return
  }
  const result=await runProcess('python3',['-c',CLOSE_POSIX_TERMINAL,fixture.root,process.execPath,String(fixture.port)],{cwd:fixture.root,env:fixture.env})
  assert.equal(result.status,0,result.stderr||result.error?.message)
  assert.match(result.stdout,/FIXTURE_LAUNCHER_RETURNED:0/)
  assert.match(result.stdout,/PTY_CLOSED_AND_SHELL_EXITED/)
  assert.equal(await fixture.read('shell-hup'),'hup','terminal close must actually deliver HUP to its controlling shell')
  const current=await probePort(fixture.port)
  assert.equal(current.state,'owned','Host must survive terminal session closing')
  assert.equal(current.processes.length,1)
  await new Promise(resolve=>setTimeout(resolve,150))
  const after=await probePort(fixture.port)
  assert.equal(after.state,'owned')
  assert.equal(after.processes[0].pid,current.processes[0].pid)
})
