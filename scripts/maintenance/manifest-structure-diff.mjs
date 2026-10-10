#!/usr/bin/env node
// One-off migration acceptance check for the manifest note slimming (OpenSpec
// change github-facade-refresh, design D7, capability repo-layout).
//
//   node scripts/maintenance/manifest-structure-diff.mjs <base-ref> [--root <dir>]
//
// Takes `dsh.yaml` as it was at <base-ref> (`git show <base-ref>:dsh.yaml`) and
// the working-tree `dsh.yaml`, parses both, deletes `note` and `brief` from every
// `customizations` entry (and from `thirdPartyResources` entries, which may
// carry them), and deep-compares the rest. Prints `structure unchanged` and
// exits 0 when equal; otherwise prints the differing paths such as
// `customizations[3].version` and exits 1. Exit 2 is a usage or read error.
// Comments never survive parsing, so they are free to change. No network.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const SECTIONS = ['customizations', 'thirdPartyResources']
const HUMAN_FIELDS = ['note', 'brief']

/** Copy of a parsed manifest without the human-readable fields of list entries. */
export function stripHumanFields(manifest) {
  const copy = structuredClone(manifest ?? {})
  for (const section of SECTIONS) {
    if (!Array.isArray(copy[section])) continue
    for (const entry of copy[section]) {
      if (entry === null || typeof entry !== 'object') continue
      for (const field of HUMAN_FIELDS) delete entry[field]
    }
  }
  return copy
}

const isObject = (value) => value !== null && typeof value === 'object'

/** Paths (`a.b[2].c`) at which two parsed values differ; arrays compare by index. */
export function differingPaths(left, right, at = '') {
  if (Array.isArray(left) && Array.isArray(right)) {
    const out = []
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      if (i >= left.length || i >= right.length) out.push(`${at}[${i}]`)
      else out.push(...differingPaths(left[i], right[i], `${at}[${i}]`))
    }
    return out
  }
  if (isObject(left) && isObject(right) && !Array.isArray(left) && !Array.isArray(right)) {
    const out = []
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    for (const key of keys) {
      const child = at === '' ? key : `${at}.${key}`
      if (!(key in left) || !(key in right)) out.push(child)
      else out.push(...differingPaths(left[key], right[key], child))
    }
    return out
  }
  return Object.is(left, right) ? [] : [at === '' ? '(root)' : at]
}

/** Compare two manifest texts; returns the list of differing paths. */
export function compareManifests(beforeText, afterText) {
  return differingPaths(stripHumanFields(yaml.load(beforeText)), stripHumanFields(yaml.load(afterText)))
}

function readBase(root, ref) {
  const result = spawnSync('git', ['show', `${ref}:dsh.yaml`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`cannot read dsh.yaml at ${ref}: ${(result.stderr || result.error?.message || '').trim()}`)
  return result.stdout
}

function main(argv) {
  const args = argv.slice(2)
  const positional = []
  let root = process.cwd() // the repository the command is run in (so a fixture repo works)
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root') root = path.resolve(args[(i += 1)])
    else positional.push(args[i])
  }
  if (positional.length !== 1) {
    console.error('usage: manifest-structure-diff.mjs <base-ref> [--root <dir>]')
    process.exitCode = 2
    return
  }
  let differences
  try {
    differences = compareManifests(readBase(root, positional[0]), readFileSync(path.join(root, 'dsh.yaml'), 'utf8'))
  } catch (error) {
    console.error(`[manifest-structure-diff] ${error.message}`)
    process.exitCode = 2
    return
  }
  if (differences.length === 0) {
    console.log('structure unchanged')
    return
  }
  console.log(`structure changed at ${differences.length} path(s):`)
  for (const entry of differences) console.log(`  ${entry}`)
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv)
