import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { insertSection, nextVersion, promoteUnreleased, setManifestVersion } from '../scripts/release-package.mjs'

test('only the named manifest entry gets the new version', () => {
  const manifest = 'customizations:\n  - id: a\n    version: 1.0.0\n  - id: dsh-magpie-connector\n    type: package\n    version: 0.6.11\n    note: version: x\n  - id: b\n    version: 0.6.11\n'
  assert.equal(setManifestVersion(manifest, 'dsh-magpie-connector', '0.6.12'),
    manifest.replace('    version: 0.6.11\n    note', '    version: 0.6.12\n    note'))
  assert.equal(setManifestVersion(manifest, 'missing', '9.9.9'), manifest)
})

test('versions bump by part', () => {
  assert.equal(nextVersion('0.6.11', 'patch'), '0.6.12')
  assert.equal(nextVersion('0.6.11', 'minor'), '0.7.0')
  assert.equal(nextVersion('0.6.11', 'major'), '1.0.0')
  assert.throws(() => nextVersion('1.0.0-rc.1', 'patch'), /non-release/)
})

test('a non-empty Unreleased section becomes the version section', () => {
  const log = '# Changelog\n\n## Unreleased\n\n- fixed a thing\n\n## 0.6.11 — 2026-11-09\n\n- old\n'
  assert.equal(promoteUnreleased(log, '0.6.12', '2026-11-10'), '# Changelog\n\n## 0.6.12 — 2026-11-10\n\n- fixed a thing\n\n## 0.6.11 — 2026-11-09\n\n- old\n')
  assert.equal(promoteUnreleased('# Changelog\n\n## Unreleased\n\n## 0.6.11\n', '0.6.12', '2026-11-10'), undefined)
  assert.equal(promoteUnreleased('# Changelog\n\n## 0.6.11\n', '0.6.12', '2026-11-10'), undefined)
})

test('generated entries go before the newest version section', () => {
  assert.equal(insertSection('# Changelog\n\n## 0.6.11\n', '0.6.12', '2026-11-10', ['fix: a', 'fix: b']),
    '# Changelog\n\n## 0.6.12 — 2026-11-10\n\n- fix: a\n- fix: b\n\n## 0.6.11\n')
})

test('the release workflow is dispatch-only, serialized with mirror sync and dispatches it', () => {
  const workflow = yaml.load(readFileSync(new URL('../.github/workflows/release-package.yml', import.meta.url), 'utf8'))
  const mirror = yaml.load(readFileSync(new URL('../.github/workflows/mirror-release.yml', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.equal(workflow.concurrency.group, mirror.concurrency.group)
  assert.deepEqual([...workflow.on.workflow_dispatch.inputs.package.options].sort(), mirror.jobs.mirror.strategy.matrix.include.map(entry => entry.dir).sort())
  const run = workflow.jobs.release.steps.map(step => step.run ?? '').join('\n')
  assert.match(run, /mirror-sync\.mjs .*--push-origin/)
  assert.match(run, /release-package\.mjs/)
  assert.match(run, /gh workflow run mirror-release\.yml/)
  assert.equal(mirror.jobs.mirror.strategy['max-parallel'], 1)
  assert.equal(mirror.permissions.contents, 'write')
})
