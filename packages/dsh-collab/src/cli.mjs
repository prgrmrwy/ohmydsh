#!/usr/bin/env node
import { salvage } from './index.js'
const usage = 'Usage: dsh-collab-salvage --data-dir ABSOLUTE --space-id ID   (run only while the Host is stopped)'
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') console.log(usage)
else if (args.length !== 4 || args[0] !== '--data-dir' || args[2] !== '--space-id') { console.error(usage); process.exitCode = 1 }
else {
  try {
    const result = await salvage({ dataDir: args[1], spaceId: args[3] })
    for (const line of result.lines) (result.code ? console.error : console.log)(line)
    process.exitCode = result.code
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
