// Shared fixture for sync / overlay tests: a throwaway public repo, an optional
// external overlay root, a DSH home, and a fake DSH CLI.
//
// The fake CLI mirrors the three runtime behaviours sync depends on, so tests can
// assert on profile bytes without a real DSH:
//   --profile <p> --dump-default-config   -> initProfile (writes the profile manifest)
//   plugin --profile <p> add <spec...>    -> install + record in dependencies
//   plugin --profile <p> remove <name...> -> uninstall + drop from dependencies
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const FAKE_DSH = `#!${process.execPath}
const fs = require('fs')
const path = require('path')
const [profileDir, actionsLog] = [process.env.FAKE_DSH_PROFILE, process.env.FAKE_DSH_ACTIONS]
const argv = process.argv.slice(2)
fs.appendFileSync(actionsLog, argv.join(' ') + '\\n')
const pkgPath = path.join(profileDir, 'package.json')
const readPkg = () => JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const writePkg = (p) => fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2))
if (argv[2] === '--dump-default-config') {
  fs.mkdirSync(profileDir, { recursive: true })
  if (!fs.existsSync(pkgPath)) writePkg({ name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } })
  process.exit(0)
}
if (argv[0] !== 'plugin') process.exit(0)
if (process.env.FAKE_DSH_FAIL === '1') process.exit(1)
const action = argv[3]
const values = argv.slice(4)
const p = readPkg()
p.dependencies = p.dependencies || {}
for (const value of values) {
  if (action === 'add') {
    let name, version, recorded
    if (value.startsWith('file:')) {
      const src = value.slice(5)
      const srcPkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'))
      name = srcPkg.name
      const dst = path.join(profileDir, 'node_modules', ...name.split('/'))
      fs.rmSync(dst, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.cpSync(src, dst, { recursive: true, filter: (s) => !s.split(path.sep).includes('node_modules') })
      recorded = value
    } else {
      const at = value.lastIndexOf('@')
      name = value.slice(0, at)
      version = value.slice(at + 1)
      const dst = path.join(profileDir, 'node_modules', ...name.split('/'))
      fs.mkdirSync(dst, { recursive: true })
      fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify({ name, version }))
      recorded = version
    }
    p.dependencies[name] = recorded
  } else if (action === 'remove') {
    delete p.dependencies[value]
    fs.rmSync(path.join(profileDir, 'node_modules', ...value.split('/')), { recursive: true, force: true })
  }
}
writePkg(p)
`

/**
 * Build a throwaway repo, overlay root and DSH home.
 *
 * @param {object} [options]
 * @param {string} [options.manifest] - public dsh.yaml body (default: empty customizations).
 * @param {boolean} [options.externalRoot] - create a separate overlay root directory.
 * @param {boolean} [options.initProfile] - pre-create the profile manifest.
 * @param {boolean} [options.createHome] - create the DSH home directory at all.
 */
export async function overlayFixture({ manifest, externalRoot = true, initProfile = true, createHome = true } = {}) {
  // realpath: macOS tmpdir is a symlink (/var -> /private/var) and sync derives
  // its repo root from import.meta.url, which Node resolves.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-ovr-')))
  const repo = path.join(root, 'repo')
  const overlayRoot = externalRoot ? path.join(root, 'private') : repo
  const dshHome = path.join(root, 'home')
  const profile = path.join(dshHome, 'profiles', 'web')
  const actions = path.join(root, 'actions.log')
  const fakeDsh = path.join(root, 'fake-dsh')

  await mkdir(repo, { recursive: true })
  await cp(path.join(REPO, 'scripts'), path.join(repo, 'scripts'), { recursive: true })
  await symlink(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'fixture-public', private: true, type: 'module', workspaces: ['packages/*'],
  }, null, 2) + '\n')
  await writeFile(path.join(repo, 'dsh.yaml'), manifest ?? 'dshVersion: 0.1.0-rc.7\ndependencies: []\ncustomizations: []\n')
  if (externalRoot) await mkdir(overlayRoot, { recursive: true })
  if (createHome) await mkdir(dshHome, { recursive: true })
  if (initProfile) {
    await mkdir(profile, { recursive: true })
    await writeFile(path.join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
    }, null, 2))
  }
  await writeFile(fakeDsh, FAKE_DSH)
  await chmod(fakeDsh, 0o755)

  const overlayFile = path.join(overlayRoot, 'dsh.yaml.local')
  const baseEnv = (extra) => ({
    ...process.env,
    DSH_HOME: dshHome,
    DSH_BIN: fakeDsh,
    FAKE_DSH_PROFILE: profile,
    FAKE_DSH_ACTIONS: actions,
    DSH_LOCAL_MANIFEST: externalRoot ? overlayFile : '',
    ...extra,
  })
  const runScript = (script, args = [], extraEnv = {}) => spawnSync(process.execPath, [path.join(repo, 'scripts', script), ...args], {
    cwd: repo, encoding: 'utf8', env: baseEnv(extraEnv),
  })

  /** Write a file relative to a root, creating parents. */
  const put = async (base, rel, content) => {
    const file = path.join(base, rel)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
    return file
  }

  return {
    root, repo, overlayRoot, overlayFile, dshHome, profile, actions,
    env: baseEnv,
    sync: (args = [], extraEnv = {}) => runScript('sync.mjs', args, extraEnv),
    runScript,
    writeOverlay: (content) => put(overlayRoot, 'dsh.yaml.local', content),
    putPublic: (rel, content) => put(repo, rel, content),
    putOverlay: (rel, content) => put(overlayRoot, rel, content),
    profilePkg: async () => JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8')),
    readPatch: async () => {
      const file = path.join(profile, 'cordis.patch.yml')
      return existsSync(file) ? readFile(file, 'utf8') : undefined
    },
    actionLog: async () => (existsSync(actions) ? readFile(actions, 'utf8') : ''),
  }
}

/**
 * Content snapshot of a directory tree: relative path -> sha256 (files),
 * `dir` (directories) or `-> target` (symlinks). A missing root snapshots as
 * `null`, so "the directory was not created" is comparable too.
 */
export async function snapshotTree(dir) {
  if (!existsSync(dir)) return null
  const out = {}
  const walk = async (current) => {
    for (const entry of (await readdir(current)).sort()) {
      const abs = path.join(current, entry)
      const rel = path.relative(dir, abs)
      const info = await lstat(abs)
      if (info.isSymbolicLink()) out[rel] = `-> ${await readlink(abs)}`
      else if (info.isDirectory()) { out[rel] = 'dir'; await walk(abs) }
      else out[rel] = createHash('sha256').update(await readFile(abs)).digest('hex')
    }
  }
  await walk(dir)
  return out
}

/** Minimal publishable local package source (no build step). */
export function localPackageJson(name, extra = {}) {
  return JSON.stringify({
    name, version: '1.0.0', type: 'module', main: './index.js', files: ['index.js'], ...extra,
  }, null, 2)
}
