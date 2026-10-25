// Inert filesystem probe only: never touches a real launcher or runs scripts.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, rename, unlink, realpath, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
if (process.platform !== 'win32') throw new Error('Native Windows required')
const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-pointer-probe-'))
for (const name of ['old', 'new']) { await mkdir(path.join(root, name)); await writeFile(path.join(root, name, 'marker'), name) }
const link = path.join(root, 'launcher'); const next = path.join(root, 'next'); const backup = path.join(root, 'backup')
await symlink('old', link, 'dir'); await symlink('new', next, 'dir')
let refused = false
try { await rename(next, link) } catch (error) { refused = true; console.log(JSON.stringify({ replaceExisting: error.code, syscall: error.syscall })) }
assert.equal(refused, true, 'Observed failure must reproduce on this Node/OS')
assert.equal(await readFile(path.join(link, 'marker'), 'utf8'), 'old')
await rename(link, backup)
await rename(next, link)
assert.equal(await readFile(path.join(link, 'marker'), 'utf8'), 'new')
await unlink(link)
await rename(backup, link)
assert.equal(await readFile(path.join(link, 'marker'), 'utf8'), 'old')
assert.equal(await readFile(path.join(root, 'new/marker'), 'utf8'), 'new')
console.log(JSON.stringify({ root, link: await realpath(link), replacementAndRollback: 'PASS', targetContentsRetained: true, note: 'two renames have a bounded absent-pointer interval; not an atomic replace primitive' }))
