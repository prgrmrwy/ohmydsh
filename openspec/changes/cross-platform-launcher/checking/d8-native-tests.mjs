// Refresh only a previously verified candidate with matching expected digests.
// Does not install dependencies or execute builder/Host.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
if (process.platform !== 'win32') throw new Error('Native Windows required')
const repo = 'D:\\opensource\\ohmydsh'
const source = path.resolve(import.meta.dirname, '../../../..')
const files = ['packages/dsh-pet/compat/subagent/compat-script-policy.cjs', 'packages/dsh-pet/compat/subagent/compat-publish.cjs', 'packages/dsh-pet/compat/subagent/install-script-policy.json', 'packages/dsh-pet/compat/subagent/compat-build-lock.cjs', 'packages/dsh-pet/compat/subagent/compat-run.cjs', 'packages/dsh-pet/compat/subagent/build-launcher.cjs', 'scripts/lib/dsh-host-runtime.mjs', 'tests/compat-launcher-policy.test.mjs', 'tests/compat-launcher-publish.test.mjs', 'tests/dsh-host-runtime.test.mjs']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const mode = process.argv[2] || 'inspect'
if (mode === 'inspect') {
  const records = []
  for (const file of files) records.push({ file, native: hash(await fs.readFile(path.join(repo, file))), candidate: hash(await fs.readFile(path.join(source, file))) })
  console.log(JSON.stringify(records, null, 2))
} else if (mode === 'execute') {
  const expected = JSON.parse(await fs.readFile(new URL('./baselines/d8-native-expected.json', import.meta.url)))
  for (const file of files) if (hash(await fs.readFile(path.join(repo, file))) !== expected[file]) throw new Error('Native candidate changed: ' + file)
  for (const file of files) await fs.copyFile(path.join(source, file), path.join(repo, file))
  const result = spawnSync(process.execPath, ['--test', 'tests/compat-launcher-policy.test.mjs', 'tests/compat-launcher-publish.test.mjs', 'tests/dsh-host-runtime.test.mjs'], { cwd: repo, env: { ...process.env }, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
  console.log(result.stdout); console.error(result.stderr)
  process.exitCode = result.status ?? 1
} else throw Error('Unknown mode')
