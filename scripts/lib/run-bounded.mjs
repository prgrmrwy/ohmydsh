#!/usr/bin/env node
// Internal helper: run one provision command in its own process group and bound
// its lifetime. The synchronous launcher waits on this short-lived supervisor;
// the supervisor can still TERM/KILL the whole npm/pnpm descendant tree.
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const EXIT_TIMEOUT = 124
const fail = (message, code = 2) => {
  console.error(`bounded-provision: ${message}`)
  process.exit(code)
}

let request
try {
  request = JSON.parse(readFileSync(0, 'utf8'))
} catch (error) {
  fail(`invalid request: ${error instanceof Error ? error.message : String(error)}`)
}

const { command, args, cwd, timeoutMs, killGraceMs } = request ?? {}
if (typeof command !== 'string' || command === '' || !Array.isArray(args)
  || args.some(value => typeof value !== 'string') || typeof cwd !== 'string'
  || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
  || !Number.isSafeInteger(killGraceMs) || killGraceMs < 1) {
  fail('request must contain command, string args, cwd, timeoutMs and killGraceMs')
}

const detached = process.platform !== 'win32'
let timedOut = false
let childClosed = false
let childStatus = 1
let childSignal
let finishTimer

const child = spawn(command, args, {
  cwd,
  env: process.env,
  stdio: 'inherit',
  detached,
})

function signalTree(signal) {
  if (child.pid === undefined) return
  try {
    process.kill(detached ? -child.pid : child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') console.error(`bounded-provision: ${signal} failed: ${error.message}`)
  }
}

function finish() {
  if (finishTimer !== undefined) clearTimeout(finishTimer)
  if (timedOut) process.exit(EXIT_TIMEOUT)
  if (childSignal !== undefined && childSignal !== null) process.exit(1)
  process.exit(childStatus ?? 1)
}

child.once('error', error => fail(`cannot start ${command}: ${error.message}`, 127))
child.once('close', (status, signal) => {
  childClosed = true
  childStatus = status
  childSignal = signal
  // After a timeout the supervisor must stay alive through the KILL phase even
  // when the group leader exits promptly on TERM; descendants may ignore TERM.
  if (!timedOut) finish()
})

finishTimer = setTimeout(() => {
  timedOut = true
  console.error(`bounded-provision: timeout after ${timeoutMs}ms; terminating ${command}`)
  signalTree('SIGTERM')
  setTimeout(() => {
    // Kill the process group even if its leader already exited after TERM: npm
    // and pnpm may leave descendants holding an install/cache lock.
    signalTree('SIGKILL')
    if (childClosed) finish()
    else setTimeout(finish, Math.min(250, killGraceMs))
  }, killGraceMs)
}, timeoutMs)
