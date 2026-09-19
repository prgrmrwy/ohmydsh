#!/usr/bin/env node
/**
 * Sync the memex tool surface (name + description) into this package.
 *
 * The model-facing tool descriptions are memex's own tuned prompts; this package
 * carries them verbatim rather than re-authoring them. They live inside memex's
 * compiled CLI as string literals, so they are extracted at *sync* time — never
 * at runtime, where a mismatch would silently mean "we are using a stale
 * description" and be hard to notice.
 *
 * Usage:
 *   node scripts/sync-memex-descriptions.mjs           # regenerate
 *   node scripts/sync-memex-descriptions.mjs --check   # exit 1 if drifted
 *
 * See openspec/changes/dsh-memex-scoped-memory/design.md (D12).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')
const outFile = join(pkgRoot, 'src', 'tools', 'descriptions.generated.ts')

/** Tool ids this package registers, in registration order. */
const TOOLS = [
  'memex_recall',
  'memex_retro',
  'memex_search',
  'memex_read',
  'memex_write',
  'memex_links',
  'memex_archive',
  'memex_organize',
]

function resolveKernelRoot() {
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
  const candidate = join(globalRoot, '@touchskyer', 'memex')
  if (!existsSync(join(candidate, 'dist', 'cli.js'))) {
    throw new Error(
      `memex CLI not found under ${candidate}. Install it with:\n` +
        `  npm install -g @touchskyer/memex --registry=https://registry.npmjs.org/`,
    )
  }
  return candidate
}

function kernelVersion(kernelRoot) {
  return JSON.parse(readFileSync(join(kernelRoot, 'package.json'), 'utf8')).version
}

/**
 * Read one string literal starting at `at` (which must point at the opening
 * quote). Walks the literal so escaped quotes do not terminate it, then decodes
 * it with JSON.parse — the literals are plain JSON strings, so escapes such as
 * \u2014 decode correctly instead of leaking into the generated file.
 */
function readStringLiteral(source, at) {
  if (source[at] !== '"') throw new Error(`expected a string literal at offset ${at}`)
  let i = at + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '"') return { value: JSON.parse(source.slice(at, i + 1)), end: i + 1 }
    i += 1
  }
  throw new Error(`unterminated string literal at offset ${at}`)
}

function extract(source, tool) {
  const anchor = source.indexOf(`server.registerTool("${tool}"`)
  if (anchor < 0) throw new Error(`tool ${tool} not found in the kernel bundle`)
  const descAt = source.indexOf('description:', anchor)
  if (descAt < 0) throw new Error(`no description for ${tool}`)
  const quoteAt = source.indexOf('"', descAt)
  return readStringLiteral(source, quoteAt).value
}

function render(version, entries) {
  const body = entries
    .map(e => `  ${JSON.stringify(e.name)}: ${JSON.stringify(e.description)},`)
    .join('\n')
  return `// GENERATED FILE — do not edit by hand.
// Source: @touchskyer/memex@${version} (dist/cli.js)
// Regenerate: npm run sync:descriptions   ·   Verify: npm run check:descriptions
//
// These are the kernel's own model-facing tool descriptions, carried verbatim so
// the tool surface keeps its upstream prompting. See design.md D12.

/** Kernel version these descriptions were extracted from. */
export const KERNEL_VERSION = ${JSON.stringify(version)}

/** Tool name to model-facing description, as published by the kernel. */
export const TOOL_DESCRIPTIONS = {
${body}
} as const

export type ToolName = keyof typeof TOOL_DESCRIPTIONS
`
}

function main() {
  const check = process.argv.includes('--check')
  const kernelRoot = resolveKernelRoot()
  const version = kernelVersion(kernelRoot)
  const source = readFileSync(join(kernelRoot, 'dist', 'cli.js'), 'utf8')
  const entries = TOOLS.map(name => ({ name, description: extract(source, name) }))
  const next = render(version, entries)

  if (check) {
    const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : ''
    if (current !== next) {
      console.error(
        `Tool descriptions are out of sync with @touchskyer/memex@${version}.\n` +
          `Run: npm run sync:descriptions`,
      )
      process.exit(1)
    }
    console.log(`Descriptions match @touchskyer/memex@${version}.`)
    return
  }

  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, next)
  console.log(`Wrote ${outFile} from @touchskyer/memex@${version} (${entries.length} tools).`)
}

main()
