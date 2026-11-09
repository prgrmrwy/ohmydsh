#!/usr/bin/env node
// Two-way sync between a monorepo package directory and its standalone mirror repository.
//
//   node scripts/mirror-sync.mjs --prefix packages/<dir> --mirror <url> [--push-origin] [--force]
//
// The mirror's main is a `git subtree split` of <prefix>, but PRs may also merge on the mirror.
// Before splitting, mirror commits the monorepo does not contain are merged back into <prefix>
// (`-Xsubtree`); the split then reuses the mirror's own commits (`--onto`), so the mirror only
// ever fast-forwards and keeps its SHAs and authorship. The first run joins the two unrelated
// histories once with an `-s ours` merge, which changes no file. A merge-back conflict, or a
// mirror that diverged before the join, fails without pushing anything: a person resolves it.
//
// `--rejoin` is deliberately not used: on a merge-heavy history it recurses past dash's function
// depth limit and is ~10x slower. `--force` (a renamed package directory) rewrites the mirror
// main with a fresh split and skips merge-back.
//
// Prints the mirror main commit after the sync; with GITHUB_OUTPUT set, also writes `split=<sha>`.
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const prefix = option('--prefix')
const mirror = option('--mirror')
const pushOrigin = args.includes('--push-origin')
const force = args.includes('--force')
if (!prefix || !mirror) { console.error('usage: mirror-sync.mjs --prefix <dir> --mirror <url> [--push-origin] [--force]'); process.exit(2) }
const name = path.basename(prefix)

function git(argv, { allowFail = false } = {}) {
  const result = spawnSync('git', argv, { encoding: 'utf8', maxBuffer: 64 << 20 })
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${argv.join(' ')} failed (${result.status}):\n${(result.stderr || result.stdout).trim()}`)
  }
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() }
}
const rev = ref => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true }).out || undefined
const ancestor = (a, b) => git(['merge-base', '--is-ancestor', a, b], { allowFail: true }).ok
const related = (a, b) => git(['merge-base', a, b], { allowFail: true }).ok
const split = onto => git(['subtree', 'split', `--prefix=${prefix}`, ...onto ? [`--onto=${onto}`] : [], 'HEAD']).out.split('\n').at(-1)

function main() {
  const start = rev('HEAD')
  const fetched = git(['fetch', '--no-tags', mirror, '+refs/heads/main:refs/mirror-sync/main'], { allowFail: true })
  const remote = fetched.ok ? rev('refs/mirror-sync/main') : undefined
  if (!fetched.ok && !/couldn't find remote ref/i.test(fetched.err)) throw new Error(`fetching ${mirror} main failed:\n${fetched.err}`)

  if (force || !remote) {
    const result = split()
    git(['push', ...force ? ['--force'] : [], mirror, `${result}:refs/heads/main`])
    return result
  }

  if (!ancestor(remote, 'HEAD')) {
    if (!related(remote, 'HEAD')) {
      // First two-way sync: connect the histories at the last commit both sides agree on.
      const fresh = split()
      if (fresh !== remote && !ancestor(fresh, remote)) {
        throw new Error(`${name}: the mirror main ${remote} is neither the monorepo split ${fresh} nor a descendant of it; resolve the divergence manually`)
      }
      git(['merge', '-s', 'ours', '--allow-unrelated-histories', '--no-edit', '-m', `chore(mirror): join ${name} mirror history`, fresh])
      console.error(`${name}: joined the mirror history at ${fresh}`)
    }
    if (!ancestor(remote, 'HEAD')) {
      const merged = git(['merge', '--no-ff', `-Xsubtree=${prefix}`, '-m', `chore(mirror): merge ${name} mirror main back`, remote], { allowFail: true })
      if (!merged.ok) {
        git(['merge', '--abort'], { allowFail: true })
        git(['reset', '--hard', start])
        throw new Error(`${name}: merging the mirror main ${remote} back into ${prefix} conflicts; merge it by hand:\n  git fetch ${mirror} main && git merge -Xsubtree=${prefix} FETCH_HEAD\n${merged.out}\n${merged.err}`)
      }
      console.error(`${name}: merged mirror main ${remote} back`)
    }
  }

  if (pushOrigin && rev('HEAD') !== start) git(['push', 'origin', 'HEAD:refs/heads/main'])

  const result = split(remote)
  if (!ancestor(remote, result)) throw new Error(`${name}: split ${result} does not contain the mirror main ${remote}`)
  if (result !== remote) git(['push', mirror, `${result}:refs/heads/main`])
  return result
}

try {
  const result = main()
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `split=${result}\n`)
  console.log(result)
} catch (error) {
  console.error(String(error.message ?? error))
  process.exit(1)
}
