/**
 * The migration command as an INSTALLED package would run it.
 *
 * The script loads the Host's row validation from the package's own `lib/`, and
 * that code imports `zod`. In this repository `zod` happens to be hoisted next
 * to everything, which would hide a missing declaration, so this test rebuilds
 * a production-shaped layout from the packed tarball: only the package's
 * DECLARED `dependencies` are installed inside it (not hoisted), the Host's
 * peers are absent (as in a real profile), the command is reached through a `node_modules/.bin`
 * symlink, and the working directory is outside any repository.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PET_DOMAIN_VERSION } from '../src/host/spec.js'
import { tempPetHome } from './support/pet-sqlite.js'
import { seedV19State, v19Main, v19Row } from './support/v19-seed.js'

const PACKAGE_DIR = path.resolve(new URL('..', import.meta.url).pathname)

interface Manifest { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }

function link(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true })
  symlinkSync(from, to, 'dir')
}

/** Pack the package and lay it out like `npm install` would, without hoisting. */
function installFromTarball(): { readonly bin: string; readonly cwd: string; readonly installed: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'pet-installed-'))
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: PACKAGE_DIR, encoding: 'utf8' })) as { filename: string }[]
  const installed = path.join(root, 'node_modules', 'dsh-pet')
  mkdirSync(installed, { recursive: true })
  execFileSync('tar', ['-xzf', path.join(root, packed[0]!.filename), '-C', installed, '--strip-components=1'])

  const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')) as Manifest
  const repoResolve = createRequire(path.join(PACKAGE_DIR, 'package.json'))
  const packageDirOf = (name: string): string | undefined => {
    try { return path.dirname(repoResolve.resolve(`${name}/package.json`)) } catch { return undefined }
  }
  // What npm installs for the package itself: its dependencies, nested.
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const source = packageDirOf(name)
    if (source !== undefined) link(source, path.join(installed, 'node_modules', name))
  }
  // Host peers are deliberately NOT laid out: in a real DSH profile they live
  // in the Host's own install and are unresolvable from a standalone script.
  // Linking them here once hid a crash on `@deepseek-ai/dsh-storage-domain`.
  const bin = path.join(root, 'node_modules', '.bin', 'dsh-pet-migrate-state')
  mkdirSync(path.dirname(bin), { recursive: true })
  symlinkSync('../dsh-pet/scripts/migrate-state-version.mjs', bin)
  return { bin, installed, cwd: mkdtempSync(path.join(tmpdir(), 'pet-installed-cwd-')) }
}

describe('the installed migration command', () => {
  it('keeps Host-provided peers off the import path of spec.ts', () => {
    const source = readFileSync(path.join(PACKAGE_DIR, 'src/host/spec.ts'), 'utf8')
    expect(source).not.toMatch(/from '@deepseek-ai\//)
  })

  it('--self-check loads the migration modules without Host peers or a database', () => {
    const { bin, cwd } = installFromTarball()
    const result = spawnSync(process.execPath, [bin, '--self-check'], { cwd, encoding: 'utf8' })
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (package|module)/)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('self-check')
  })

  it('declares the self-check as a deploy check for dsh build', () => {
    const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as Manifest & { ohmydsh?: { deployChecks?: unknown } }
    expect(manifest.ohmydsh?.deployChecks).toEqual([{ bin: 'dsh-pet-migrate-state', args: ['--self-check'] }])
  })

  it('declares zod as a runtime dependency', () => {
    const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')) as Manifest
    expect(manifest.dependencies?.zod).toBeDefined()
    expect(manifest.devDependencies?.zod).toBeUndefined()
  })

  it('spec Scenario "自检导入全部整形与预检模块"', () => {
    const { bin, cwd, installed } = installFromTarball()
    const ok = spawnSync(process.execPath, [bin, '--self-check'], { cwd, encoding: 'utf8' })
    expect(ok.status, ok.stderr).toBe(0)
    // Every module the v20 shaping and the final validation load, actually imported.
    expect(ok.stdout).toContain('loaded ../lib/host/locus/locus-set-v20.js')
    // The old-shape preflight lives in the script itself: it must not lean on the v19 Host validator.
    expect(readFileSync(path.join(installed, 'scripts/migrate-state-version.mjs'), 'utf8')).not.toContain('persistence.js')

    for (const missing of ['lib/host/locus/locus-set-v20.js', 'lib/host/locus/contract-v20.js']) {
      const broken = installFromTarball()
      rmSync(path.join(broken.installed, missing))
      const result = spawnSync(process.execPath, [broken.bin, '--self-check'], { cwd: broken.cwd, encoding: 'utf8' })
      expect(result.status, `${missing}: ${result.stdout}`).toBe(1)
      expect(result.stderr).toContain('self-check')
    }
  })

  it('spec Scenario "已安装的命令在仓库外可用"', async () => {
    const { bin, cwd } = installFromTarball()
    const { file } = tempPetHome('pet-installed-db-')
    await seedV19State(file, 18, {
      locus_mains: { 'main-1': v19Main({ id: 'main-1' }) },
      loci: {
        'old-1': { ...v19Row({ id: 'old-1', chatId: 'oc_old', main: 'user-session' }), childComposition: 'safe-v2' },
        'keep-1': v19Row({ id: 'keep-1', chatId: 'oc_keep' }),
      },
    })

    const result = spawnSync(process.execPath, [bin, '--dry-run', '--db', file], { cwd, encoding: 'utf8' })

    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (package|module)/)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('old-1')
    expect(result.stdout).toMatch(/^\s+loci: 1$/m)
    expect(result.stdout).toContain(`Would migrate 18 → ${PET_DOMAIN_VERSION}`)
  })
})
