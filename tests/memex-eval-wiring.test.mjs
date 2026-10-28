// Managed wiring for the dsh-memex fixed selftest (change dsh-memex-evaluation-harness, tasks 9.x).
// Checks only the manifest source of truth and the files sync renders; never builds or deploys.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = yaml.load(readFileSync(path.join(REPO, 'dsh.yaml'), 'utf8'))
const entry = id => (manifest.customizations ?? []).find(item => item.id === id)

test('the judge preset is declared under the exact id the Host judge factory mounts', () => {
  const preset = entry('memex-eval-judge')
  assert.ok(preset, 'memex-eval-judge manifest entry')
  assert.equal(preset.type, 'preset')
  assert.equal(preset.enabled, true)
  assert.equal(preset.version, readFileSync(path.join(REPO, 'presets/memex-eval-judge/VERSION'), 'utf8').trim())
  const factory = readFileSync(path.join(REPO, 'packages/dsh-memex/src/eval/registered-judge.ts'), 'utf8')
  assert.match(factory, /preset: 'memex-eval-judge'/)
  const plugins = yaml.load(readFileSync(path.join(REPO, 'presets/memex-eval-judge/agent.cordis.yml'), 'utf8'))
  assert.ok(Array.isArray(plugins) && plugins.length === 1)
})

test('the memex-eval skill is managed, read-only by default and points only at fixed selftest commands', () => {
  const skill = entry('memex-eval')
  assert.ok(skill, 'memex-eval manifest entry')
  assert.equal(skill.type, 'skill')
  assert.equal(skill.enabled, true)
  const body = readFileSync(path.join(REPO, 'skills/memex-eval/SKILL.md'), 'utf8')
  for (const text of ['dsh-memex-eval-report', '固定虚构自检', '不能用于有效性评估', '不会自动恢复', '用户']) assert.ok(body.includes(text), text)
  assert.ok(!/--suite/.test(body.replace(/不接受[^\n]*--suite[^\n]*/g, '')), 'skill must not suggest custom suites')
})

test('selftest directory closures are managed without replacing user workspace declarations', () => {
  const patch = entry('memex-eval-config')
  assert.equal(patch?.type, 'patch')
  assert.equal(patch?.enabled, true)
  assert.equal(patch?.mergeConfig, true)
  const rows = yaml.load(readFileSync(path.join(REPO, 'patches/memex-eval-config.yml'), 'utf8'))
  assert.deepEqual(rows, [{ id: 'dsh-memex', name: 'dsh-memex', config: { evalSelftest: true } }])
})

test('the package ships the report executable and fixed fixtures that the skill relies on', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, 'packages/dsh-memex/package.json'), 'utf8'))
  assert.equal(pkg.bin['dsh-memex-eval-report'], './lib/cli/eval-report.js')
  assert.ok(pkg.files.includes('fixtures/eval'))
  assert.ok(existsSync(path.join(REPO, 'packages/dsh-memex/fixtures/eval/questions.json')))
})
