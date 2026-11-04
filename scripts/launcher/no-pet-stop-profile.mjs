import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

/** Insert the launcher plugin through the official --patch composition layer. */
export function noPetStopPatch(home, repo, dshVersion) {
  const run = path.join(home, 'run')
  const dir = path.join(run, 'dsh-launcher')
  for (const target of [run, dir]) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 })
    const stat = fs.lstatSync(target)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o022) || (target === dir && (stat.mode & 0o777) !== 0o700)) throw new Error('unsafe launcher patch directory')
  }
  const file = path.join(dir, 'no-pet-stop.patch.json')
  const temp = path.join(dir, `${randomUUID()}.tmp`)
  const content = JSON.stringify([{ insert: [{ id: 'launcher-no-pet-stop', name: pathToFileURL(path.join(repo, 'scripts/launcher/no-pet-stop-plugin.mjs')).href, config: { dshVersion } }] }])
  fs.writeFileSync(temp, content, { flag: 'wx', mode: 0o600 })
  // Both paths are confined to the verified launcher-owned private directory.
  fs.renameSync(temp, file)
  return file
}
