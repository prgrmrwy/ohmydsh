#!/usr/bin/env node
import { recoverLock } from './index.js'
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: dsh-collab-unlock --data-dir ABSOLUTE --space-id ID --expected-instance-id ID --all-hosts-stopped')
} else if (args.length !== 7 || args[0] !== '--data-dir' || args[2] !== '--space-id' || args[4] !== '--expected-instance-id' || args[6] !== '--all-hosts-stopped') {
  console.error('Usage: dsh-collab-unlock --data-dir ABSOLUTE --space-id ID --expected-instance-id ID --all-hosts-stopped')
  process.exitCode = 1
} else {
  try {
    await recoverLock({ dataDir: args[1], spaceId: args[3], expectedInstanceId: args[5], stoppedHostsConfirmed: true })
    console.log('Residual lock removed; start the single owning Host to replay the retained ledger.')
  } catch (error) { console.error(error); process.exitCode = 1 }
}
