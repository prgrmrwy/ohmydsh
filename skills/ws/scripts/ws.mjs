#!/usr/bin/env node
import { spawn } from 'node:child_process'

const child = spawn('dsh-ws', process.argv.slice(2), { stdio: 'inherit' })
child.once('error', error => {
  console.error(`ws: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = signal === null ? (code ?? 1) : 1
})
