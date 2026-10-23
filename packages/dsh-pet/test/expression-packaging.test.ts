/**
 * Packaging and import-seam contracts for the mascot animation.
 *
 * These are mechanical checks of the published artifact and of where the real
 * player is allowed to be imported: the license notice must ship, the light
 * build must be the only player, and no third-party animation may be bundled.
 * A source scan is the right tool here — the contract is about file layout and
 * import locations, not runtime state.
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = path.resolve(__dirname, '..')
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src')

/** Read one repo file as text. */
async function read(relative: string): Promise<string> {
  return readFile(path.join(PACKAGE_ROOT, relative), 'utf8')
}

/** Recursively list files under `dir`, skipping build output and deps. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(absolute)))
    else files.push(absolute)
  }
  return files
}

describe('player packaging and import seam', () => {
  it('ships the player notice in package files', async () => {
    const pkg = JSON.parse(await read('package.json')) as {
      files: string[]
      devDependencies?: Record<string, string>
    }
    expect(pkg.files).toContain('THIRD-PARTY-NOTICES.md')
    expect(pkg.devDependencies?.['lottie-web']).toBe('5.13.0')

    const notice = await read('THIRD-PARTY-NOTICES.md')
    expect(notice).toContain('lottie-web 5.13.0')
    expect(notice).toContain('The MIT License (MIT)')
    expect(notice).toContain('Copyright (c) 2015 Bodymovin')
  })

  it('imports the light player only from the browser entry', async () => {
    const player = await read('src/client/player.ts')
    expect(player).toContain('lottie_light.min.js')

    // Only the dedicated player module may mention the dependency; the overlay
    // and the policy module must stay importable without a canvas.
    for (const relative of ['src/client/overlay.tsx', 'src/client/mascot-expression.ts']) {
      expect(await read(relative)).not.toContain('lottie-web')
    }
    // The entry injects it, which is what keeps jsdom tests off the real UMD.
    expect(await read('src/client/index.tsx')).toContain("from './player.js'")
  })

  it('bundles no animation assets', async () => {
    const files = await listFiles(SOURCE_ROOT)
    expect(files.filter(file => file.endsWith('.lottie.json'))).toEqual([])
    expect(files.filter(file => file.endsWith('.tgs') || file.endsWith('.lottie'))).toEqual([])
  })
})
