import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guard: no fixture may run a real `dsh web` against the operator's real DSH
 * home.
 *
 * Two DSH processes sharing one `$DSH_HOME` both write the same session store.
 * Concurrent writers can interleave session `seq` values and corrupt real
 * conversations, so a fixture that inherits the ambient home is not merely
 * untidy — it can destroy the user's data. Isolation is therefore enforced
 * mechanically here rather than left to reviewer discipline.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TESTS = path.join(REPO, 'tests')

/**
 * Extracts the `env` argument a spawn call passes: either an inline object
 * literal or a reference to a variable holding one.
 */
function envArgumentAt(source, spawnIndex) {
  const envIndex = source.indexOf('env', spawnIndex)
  if (envIndex === -1 || envIndex - spawnIndex > 600) return undefined
  const tail = source.slice(envIndex)

  // `env,` — shorthand for a variable named `env`.
  const shorthand = /^env\s*[,}]/.exec(tail)
  if (shorthand !== null) return resolveEnvVariable(source, 'env')

  const named = /^env\s*:\s*/.exec(tail)
  if (named === null) return undefined
  const rest = tail.slice(named[0].length)

  // `env: someVariable` — resolve the variable's declaration.
  const reference = /^([A-Za-z_$][\w$]*)\s*[,}]/.exec(rest)
  if (reference !== null) return resolveEnvVariable(source, reference[1])

  if (!rest.startsWith('{')) return undefined
  let depth = 0
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '{') depth += 1
    else if (rest[index] === '}') {
      depth -= 1
      if (depth === 0) return rest.slice(0, index + 1)
    }
  }
  return undefined
}

/** Finds `const <name> = { ... }` so variable-held envs are auditable too. */
function resolveEnvVariable(source, name) {
  const declaration = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`).exec(source)
  if (declaration === null) return undefined
  const start = source.indexOf('{', declaration.index)
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return undefined
}

test('every fixture that starts a real dsh web pins an isolated DSH_HOME', async () => {
  const files = (await readdir(TESTS)).filter(name => name.endsWith('.test.mjs'))
  const offenders = []
  let audited = 0

  for (const name of files) {
    // This guard's own file contains deliberately unsafe example snippets used
    // by the mutation check below, so it must not audit itself.
    if (name === path.basename(fileURLToPath(import.meta.url))) continue
    const file = path.join(TESTS, name)
    const source = await readFile(file, 'utf8')
    const pattern = /spawn(?:Sync)?\s*\(/g
    let match
    while ((match = pattern.exec(source)) !== null) {
      // The call must actually launch the `web` server to be in scope.
      const window = source.slice(match.index, match.index + 400)
      if (!/['"]web['"]/.test(window)) continue
      audited += 1
      const env = envArgumentAt(source, match.index)
      if (env === undefined || !/DSH_HOME\s*:/.test(env)) {
        offenders.push(`${name}: dsh web spawn without an explicit DSH_HOME`)
        continue
      }
      // An explicit home must not be the ambient one: reusing the operator's
      // real home is exactly the double-writer hazard this guard exists for.
      if (/DSH_HOME\s*:\s*(?:process\.env\.DSH_HOME|os\.homedir\(\)|process\.env\.HOME)/.test(env)) {
        offenders.push(`${name}: dsh web spawn inherits the ambient DSH_HOME`)
      }
    }
  }

  assert.ok(audited >= 8, `expected to audit the known live fixtures, saw ${audited}`)
  assert.deepEqual(offenders, [], `fixtures may never share the real DSH home:\n${offenders.join('\n')}`)
})

test('the isolation guard actually rejects an unsafe fixture', () => {
  // Mutation check: the guard is only meaningful if it fails on a bad call.
  const unsafeInherited = `spawn(dsh, ['web', '--port', String(port)], {\n  env: { ...process.env, DSH_HOME: process.env.DSH_HOME },\n})`
  const unsafeMissing = `spawn(dsh, ['web', '--port', String(port)], {\n  env: { ...process.env, DSH_SKIP_UPDATE: '1' },\n})`
  const safe = `spawn(dsh, ['web', '--port', String(port)], {\n  env: { ...process.env, DSH_HOME: home, DSH_SKIP_UPDATE: '1' },\n})`

  const inheritedEnv = envArgumentAt(unsafeInherited, 0)
  assert.match(inheritedEnv ?? '', /DSH_HOME\s*:\s*process\.env\.DSH_HOME/)

  const missingEnv = envArgumentAt(unsafeMissing, 0)
  assert.equal(/DSH_HOME\s*:/.test(missingEnv ?? ''), false)

  const safeEnv = envArgumentAt(safe, 0)
  assert.match(safeEnv ?? '', /DSH_HOME\s*:\s*home/)
})
