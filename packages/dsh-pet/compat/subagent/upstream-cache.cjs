'use strict'
/**
 * Upstream checkout cache for the compat builder.
 *
 * The builder keeps a shallow upstream checkout between builds because cloning
 * and installing it is slow and needs the network. Reusing it is only safe when
 * it was last prepared for exactly the same inputs. `git checkout -- .` restores
 * tracked files but leaves gitignored build output behind, so a cache prepared
 * for an earlier upstream keeps `lib/` and `node_modules` of packages the new
 * upstream deleted, and the host build then bundles them (2026-10-08: a 0.1.5
 * `settings-file/lib` importing the removed `SettingsProvider` broke the 0.2
 * runtime build and DSH would not start).
 *
 * Rule: a stamp records the inputs of the last SUCCESSFUL build. When the
 * current inputs differ (or there is no stamp), every untracked and ignored
 * file is removed with `git clean -ffdx` before building. The stamp lives in
 * `.git/`, so `git clean` never removes it and it never appears as a stray file.
 */
const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const STAMP_VERSION = 1

/** Path of the stamp inside the checkout's git directory. */
function stampPath(checkout) {
  return join(checkout, '.git', 'dsh-compat-cache.json')
}

function inputs({ commit, patchSha256 }) {
  return { version: STAMP_VERSION, commit, patchSha256 }
}

function readStamp(checkout) {
  try { return JSON.parse(readFileSync(stampPath(checkout), 'utf8')) } catch { return undefined }
}

/**
 * Make the checkout safe to build for these inputs.
 * @returns {{ reused: boolean }} whether the previous build output was kept.
 */
function prepareUpstreamCache({ checkout, commit, patchSha256, run }) {
  const stamp = readStamp(checkout)
  const wanted = inputs({ commit, patchSha256 })
  if (stamp && stamp.version === wanted.version && stamp.commit === wanted.commit && stamp.patchSha256 === wanted.patchSha256) {
    return { reused: true }
  }
  // Drop the stamp first: if the clean or the build is interrupted, the next run
  // must not mistake a half-prepared tree for a valid cache.
  rmSync(stampPath(checkout), { force: true })
  // -ff also removes nested git repositories; -x removes ignored files (lib/, node_modules).
  run('git', ['clean', '-ffdxq'], checkout)
  return { reused: false }
}

/** Record that the checkout now holds a successful build for these inputs. */
function recordUpstreamCache({ checkout, commit, patchSha256 }) {
  if (!existsSync(join(checkout, '.git'))) return
  writeFileSync(stampPath(checkout), `${JSON.stringify(inputs({ commit, patchSha256 }))}\n`)
}

module.exports = { prepareUpstreamCache, recordUpstreamCache, stampPath }
