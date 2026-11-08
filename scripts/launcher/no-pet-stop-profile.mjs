import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ensurePrivateDirectories, assertPrivatePaths, secureNewPrivateFile } from './private-files.mjs'

/** Insert the launcher plugin through the official --patch composition layer. */
export function noPetStopPatch(home, repo, dshVersion) {
  const run = path.join(home, 'run')
  const dir = path.join(run, 'dsh-launcher')
  ensurePrivateDirectories([{ path: run, exact: false }, { path: dir, exact: true }])
  const file = path.join(dir, 'no-pet-stop.patch.json')
  try { assertPrivatePaths([{ path: file, type: 'file' }]) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const temp = path.join(dir, `${randomUUID()}.tmp`)
  const content = JSON.stringify([{ insert: [{ id: 'launcher-no-pet-stop', name: pathToFileURL(path.join(repo, 'scripts/launcher/no-pet-stop-plugin.mjs')).href, config: { dshVersion } }] }])
  const fd = fs.openSync(temp, 'wx', 0o600)
  try {
    secureNewPrivateFile(temp)
    fs.writeFileSync(fd, content)
  } finally { fs.closeSync(fd) }
  // Both paths are confined to the verified launcher-owned private directory.
  fs.renameSync(temp, file)
  return file
}
