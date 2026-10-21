import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const parent = await realpath(tmpdir())
const root = await mkdtemp(join(parent, 'dsh-collab-components-'))
try {
  const child = spawn(process.execPath, ['--test', fileURLToPath(new URL(process.argv.includes('--controller') ? './controller-seams.test.mjs' : './component-seams.test.mjs', import.meta.url))], {
    stdio: 'inherit',
    env: { PATH: process.env.PATH, HOME: root, DSH_HOME: root, DSH_COLLAB_COMPONENT_HOME: root },
  })
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  process.exitCode = result.code ?? 1
  if (result.signal) console.error(`Component test process stopped by ${result.signal}`)
} finally {
  const checked = await realpath(root)
  if (dirname(checked) !== parent || !basename(checked).startsWith('dsh-collab-components-')) throw new Error('Refuse cleanup of unexpected fixture path')
  await rm(checked, { recursive: true })
}
